// Updated content.js specifically for FanFix's message structure

// Wait for the page to fully load
window.addEventListener('load', initializeAssistant);
document.addEventListener('DOMContentLoaded', initializeAssistant);

// Set up variables
let chatObserver;
let suggestionPanel;
let lastProcessedMessage = '';
let waitingForSuggestion = false;
let debugMode = true; // Set to true for detailed logging

function debug(message, obj = null) {
  if (!debugMode) return;
  
  if (obj) {
    console.log(`%c[FanFix Assistant Debug] ${message}`, 'color: #4285f4', obj);
  } else {
    console.log(`%c[FanFix Assistant Debug] ${message}`, 'color: #4285f4');
  }
}

function initializeAssistant() {
  debug('Initializing FanFix Chat Assistant');
  
  // Check if we're on a chat page - FanFix specific
  if (window.location.href.includes('fanfix.io') && 
      (window.location.href.includes('/chat') || window.location.href.includes('/messages'))) {
    debug('FanFix chat page detected, setting up assistant');
    setupChatObserver();
    createSuggestionPanel();
  } else {
    debug('Not on a FanFix chat page. URL:', window.location.href);
  }
  
  // Listen for URL changes (for single-page applications)
  let lastUrl = window.location.href;
  new MutationObserver(() => {
    if (lastUrl !== window.location.href) {
      lastUrl = window.location.href;
      debug('URL changed to:', window.location.href);
      if (window.location.href.includes('fanfix.io') && 
          (window.location.href.includes('/chat') || window.location.href.includes('/messages'))) {
        debug('Navigated to FanFix chat page, setting up assistant');
        setupChatObserver();
        createSuggestionPanel();
      }
    }
  }).observe(document, {subtree: true, childList: true});
}

function setupChatObserver() {
  // Disconnect previous observer if exists
  if (chatObserver) {
    chatObserver.disconnect();
    debug('Disconnected previous chat observer');
  }
  
  // Find the FanFix chat container
  const findChatContainer = () => {
    debug('Looking for FanFix chat container');
    
    // Try to find the main container that holds all messages
    // Based on the HTML you provided, we'll look for a container that has message elements
    const container = document.querySelector('[data-testid="message-list-container-ms"]');
    
    if (container) {
      debug('Found FanFix chat container:', container);
      observeChatContainer(container);
    } else {
      // Broader fallback if the specific container isn't found
      const fallbackContainer = document.querySelector('.MuiBox-root');
      if (fallbackContainer) {
        debug('Using fallback container:', fallbackContainer);
        observeChatContainer(fallbackContainer);
      } else {
        // If container not found, retry after a short delay
        debug('Chat container not found, will retry in 2 seconds');
        setTimeout(findChatContainer, 2000);
      }
    }
  };
  
  findChatContainer();
}

function observeChatContainer(container) {
  debug('Setting up observer for FanFix chat container');
  
  chatObserver = new MutationObserver((mutations) => {
    debug('Detected DOM mutations in chat container:', mutations);
    let shouldProcess = false;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        debug('New nodes added to chat container');
        shouldProcess = true;
        break;
      }
    }
    
    if (shouldProcess) {
      processNewMessages();
    }
  });
  
  // Observe both direct changes and deeper changes
  chatObserver.observe(container, { childList: true, subtree: true });
  debug('Observer set up successfully for FanFix chat');
  
  // Process existing messages on first load
  processNewMessages();
}

function processNewMessages() {
  debug('Processing FanFix messages');
  
  // Using the exact selectors from the HTML you provided
  const messages = document.querySelectorAll('.mymessage, .othermessage');
  debug('messages:', messages);
  
  if (messages.length === 0) {
    debug('No FanFix messages found');
    return;
  }
  
  debug(`Found ${messages.length} FanFix messages`);
  
  // Get the last message from the fan (othermessage)
  let latestUserMessage = null;
  let latestUserMessageEl = null;
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    
    // Check if this is a message from the fan (othermessage)
    if (message.classList.contains('othermessage')) {
      // Find the text content within this message - using the exact path from your HTML
      const textElement = message.querySelector('[data-testid="message-thread-content-ds"] .interRegular14 div');
      
      if (textElement) {
        latestUserMessageEl = message;
        latestUserMessage = textElement.textContent.trim();
        debug('Found latest fan message:', latestUserMessage);
        break;
      }
    }
  }
  
  if (latestUserMessage) {
    if (latestUserMessage !== lastProcessedMessage && !waitingForSuggestion) {
      lastProcessedMessage = latestUserMessage;
      waitingForSuggestion = true;
      updateSuggestionPanel('Thinking...');
      
      try {
        // Get chat history for context
        const chatHistory = getChatHistory(messages, 10);
        debug('Chat history for context:', chatHistory);
        
        // Request suggestions from the background script
        debug('Sending message to background script for suggestions');
        chrome.runtime.sendMessage({
          action: 'getSuggestions',
          message: latestUserMessage,
          chatHistory: chatHistory
        }, (response) => {
          debug('Received response from background script:', response);
          
          if (chrome.runtime.lastError) {
            debug('Error from background script:', chrome.runtime.lastError);
            updateSuggestionPanel('Error connecting to extension. Check console for details.');
            waitingForSuggestion = false;
            return;
          }
          
          if (response && response.suggestions) {
            displaySuggestions(response.suggestions);
          } else if (response && response.error) {
            updateSuggestionPanel(`Error: ${response.error}`);
          } else {
            updateSuggestionPanel('Error getting suggestions.');
          }
          waitingForSuggestion = false;
        });
      } catch (error) {
        debug('Error processing message:', error);
        updateSuggestionPanel('Error processing message. Check console for details.');
        waitingForSuggestion = false;
      }
    }
  } else {
    debug('No fan messages found or could not extract text');
  }
}

function getChatHistory(messages, maxMessages) {
  const history = [];
  const count = Math.min(messages.length, maxMessages);
  
  for (let i = messages.length - count; i < messages.length; i++) {
    const message = messages[i];
    const isFromYou = message.classList.contains('mymessage');
    
    // Extract text using the specific path from your HTML
    const textElement = message.querySelector('[data-testid="message-thread-content-ds"] .interRegular14 div');
    const text = textElement ? textElement.textContent.trim() : '';
    
    if (text) {
      history.push({
        role: isFromYou ? 'assistant' : 'user',
        content: text
      });
    }
  }
  
  return history;
}

function createSuggestionPanel() {
  // Remove existing panel if any
  if (suggestionPanel) suggestionPanel.remove();
  
  // Create new suggestion panel
  suggestionPanel = document.createElement('div');
  suggestionPanel.className = 'fanfix-suggestion-panel';
  suggestionPanel.innerHTML = `
    <div class="suggestion-header">
      <span>💬 Response Suggestions</span>
      <button class="close-btn">×</button>
    </div>
    <div class="suggestion-content">
      <p class="waiting-message">Waiting for new messages from fans...</p>
    </div>
  `;
  
  document.body.appendChild(suggestionPanel);
  debug('Suggestion panel created');
  
  // Add event listener to close button
  suggestionPanel.querySelector('.close-btn').addEventListener('click', () => {
    suggestionPanel.classList.toggle('minimized');
    debug('Suggestion panel minimized/restored');
  });
}

function updateSuggestionPanel(message) {
  if (!suggestionPanel) createSuggestionPanel();
  
  const content = suggestionPanel.querySelector('.suggestion-content');
  content.innerHTML = `<p class="waiting-message">${message}</p>`;
  debug('Updated suggestion panel with message:', message);
}

function displaySuggestions(suggestions) {
  if (!suggestionPanel) createSuggestionPanel();
  
  const content = suggestionPanel.querySelector('.suggestion-content');
  content.innerHTML = '';
  
  debug('Displaying suggestions:', suggestions);
  
  suggestions.forEach((suggestion, index) => {
    const suggestionElement = document.createElement('div');
    suggestionElement.className = 'suggestion-item';
    suggestionElement.textContent = suggestion;
    suggestionElement.addEventListener('click', () => {
      insertSuggestion(suggestion);
    });
    content.appendChild(suggestionElement);
  });
}

function insertSuggestion(text) {
  debug('Attempting to insert suggestion:', text);
  
  // FanFix specific selector for the chat input
  const inputField = document.querySelector('[placeholder="Type your message here..."]');
  
  if (inputField) {
    debug('Found FanFix input field:', inputField);
    
    // Set the input field value to the suggestion
    inputField.value = text;
    
    // Focus the input field
    inputField.focus();
    
    // Trigger input event to activate any listeners
    const inputEvent = new Event('input', { bubbles: true });
    inputField.dispatchEvent(inputEvent);
    
    debug('Successfully inserted suggestion');
  } else {
    debug('Could not find FanFix input field');
  }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debug('Received message from popup:', request);
  
  if (request.action === 'refresh') {
    // Refresh the suggestion panel
    lastProcessedMessage = '';
    processNewMessages();
    sendResponse({ status: 'refreshing' });
  }
  
  return true;
});