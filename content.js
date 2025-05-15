// Improved content.js with debugging helpers

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
  
  // Check if we're on a chat page by looking for URL or common chat elements
  if (isOnChatPage()) {
    debug('Chat page detected, setting up assistant');
    setupChatObserver();
    createSuggestionPanel();
  } else {
    debug('Not on a chat page. URL:', window.location.href);
  }
  
  // Listen for URL changes (for single-page applications)
  let lastUrl = window.location.href;
  new MutationObserver(() => {
    if (lastUrl !== window.location.href) {
      lastUrl = window.location.href;
      debug('URL changed to:', window.location.href);
      if (isOnChatPage()) {
        debug('Navigated to chat page, setting up assistant');
        setupChatObserver();
        createSuggestionPanel();
      }
    }
  }).observe(document, {subtree: true, childList: true});
}

function isOnChatPage() {
  // First check URL pattern
  if (window.location.href.includes('fanfix.io') && 
      (window.location.href.includes('/chat') || 
       window.location.href.includes('/messages'))) {
    return true;
  }
  
  // Then check for common chat UI elements
  const possibleChatSelectors = [
    '.chat-container', '.messages-container', '.conversation-container',
    '[data-testid="chat-container"]', '[aria-label="Chat"]',
    '.chat', '#chat', '.messaging', '#messaging'
  ];
  
  for (const selector of possibleChatSelectors) {
    if (document.querySelector(selector)) {
      debug('Found chat element with selector:', selector);
      return true;
    }
  }
  
  return false;
}

function setupChatObserver() {
  // Disconnect previous observer if exists
  if (chatObserver) {
    chatObserver.disconnect();
    debug('Disconnected previous chat observer');
  }
  
  // Find the chat container with multiple possible selectors
  const findChatContainer = () => {
    debug('Looking for chat container');
    
    const possibleContainers = [
      '.chat-messages-container',
      '.messages-container',
      '.conversation-messages',
      '.message-list',
      '.chat-feed',
      '[data-testid="messages-container"]',
      // Look for the most specific container possible
      'div[role="log"]',
      'div.overflow-y-auto',
      // Most generic container as fallback
      'div.chat-container',
      'div.messaging-container'
    ];
    
    // Try each selector
    for (const selector of possibleContainers) {
      const chatContainer = document.querySelector(selector);
      if (chatContainer) {
        debug('Found chat container with selector:', selector);
        debug('Container:', chatContainer);
        observeChatContainer(chatContainer);
        return;
      }
    }
    
    // If container not found, look for any scrollable container with messages
    const scrollableContainers = document.querySelectorAll('div.overflow-y-auto, div.overflow-auto');
    for (const container of scrollableContainers) {
      // Check if it has message-like children
      if (container.querySelectorAll('[class*="message"]').length > 0) {
        debug('Found scrollable container with messages:', container);
        observeChatContainer(container);
        return;
      }
    }
    
    // If we're here, we couldn't find a container
    debug('Chat container not found, will retry in 2 seconds');
    setTimeout(findChatContainer, 2000);
  };
  
  findChatContainer();
}

function observeChatContainer(container) {
  debug('Setting up observer for container:', container);
  
  chatObserver = new MutationObserver((mutations) => {
    debug('Detected DOM mutations:', mutations.length);
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
  debug('Observer set up successfully');
  
  // Process existing messages on first load
  processNewMessages();
}

function processNewMessages() {
  debug('Processing messages');
  
  // Try multiple selectors to find messages
  const possibleMessageSelectors = [
    '.message', '[class*="message-item"]', '[class*="chat-message"]',
    '[class*="messageContainer"]', '.chat-bubble', '.text-bubble',
    'div[role="listitem"]', '[data-testid="message-item"]'
  ];
  
  let messages = [];
  
  // Try each selector until we find messages
  for (const selector of possibleMessageSelectors) {
    messages = document.querySelectorAll(selector);
    if (messages.length > 0) {
      debug(`Found ${messages.length} messages with selector: ${selector}`);
      break;
    }
  }
  
  if (messages.length === 0) {
    debug('No messages found with any selector');
    return;
  }
  
  // Determine which messages are from the other user
  // We need to identify patterns in classes that distinguish user messages from others
  let messagePatterns = analyzeMessageClasses(messages);
  debug('Message patterns detected:', messagePatterns);
  
  // Get the last message from the other user
  let latestUserMessage = null;
  let latestUserMessageEl = null;
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    
    // Check if this message is from the other user based on our pattern analysis
    if (isOtherUserMessage(message, messagePatterns)) {
      // Find the text content within this message
      latestUserMessageEl = message;
      latestUserMessage = extractMessageText(message);
      break;
    }
  }
  
  if (latestUserMessage) {
    debug('Latest user message:', latestUserMessage);
    
    if (latestUserMessage !== lastProcessedMessage && !waitingForSuggestion) {
      lastProcessedMessage = latestUserMessage;
      waitingForSuggestion = true;
      updateSuggestionPanel('Thinking...');
      
      try {
        // Get chat history for context
        const chatHistory = getChatHistory(messages, messagePatterns, 10);
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
    debug('No user messages found or could not extract text');
  }
}

function analyzeMessageClasses(messages) {
  // This function tries to determine which CSS classes distinguish between sent and received messages
  const patterns = {
    fromMeClasses: new Set(),
    fromOthersClasses: new Set(),
    messageTextSelectors: []
  };
  
  // Common patterns for message text elements
  patterns.messageTextSelectors = [
    '.message-text', '.message-content', '.text-content',
    '[class*="messageText"]', '[class*="messageContent"]',
    'p', '.bubble-content', '[class*="content"]'
  ];
  
  // Look for common patterns in message classes
  const commonRightClasses = ['sent', 'outgoing', 'from-me', 'self', 'right', 'user'];
  const commonLeftClasses = ['received', 'incoming', 'from-them', 'other', 'left'];
  
  // Check each message for classes that might indicate direction
  for (const message of messages) {
    const classList = Array.from(message.classList);
    let foundFromMe = false;
    let foundFromOther = false;
    
    // Check if any classes contain common patterns
    for (const cls of classList) {
      const lowerCls = cls.toLowerCase();
      
      // Check for "from me" indicators
      for (const rightPattern of commonRightClasses) {
        if (lowerCls.includes(rightPattern)) {
          patterns.fromMeClasses.add(cls);
          foundFromMe = true;
        }
      }
      
      // Check for "from other" indicators
      for (const leftPattern of commonLeftClasses) {
        if (lowerCls.includes(leftPattern)) {
          patterns.fromOthersClasses.add(cls);
          foundFromOther = true;
        }
      }
    }
    
    // If we can't identify by class names, try by alignment or structure
    if (!foundFromMe && !foundFromOther) {
      // Common pattern: messages from the user are often aligned right
      const computedStyle = window.getComputedStyle(message);
      if (computedStyle.textAlign === 'right' || 
          computedStyle.alignSelf === 'flex-end' || 
          computedStyle.marginLeft === 'auto') {
        // This might be a message from the current user
        if (message.className) {
          patterns.fromMeClasses.add(message.className.split(' ')[0]);
        }
      } else if (computedStyle.textAlign === 'left' || 
                computedStyle.alignSelf === 'flex-start' || 
                computedStyle.marginRight === 'auto') {
        // This might be a message from the other user
        if (message.className) {
          patterns.fromOthersClasses.add(message.className.split(' ')[0]);
        }
      }
    }
  }
  
  return patterns;
}

function isOtherUserMessage(messageElement, patterns) {
  // Check if this message is from the other user based on class patterns
  
  // First, check if it has any classes that indicate it's from the other user
  const classList = Array.from(messageElement.classList);
  for (const cls of classList) {
    if (patterns.fromOthersClasses.has(cls)) {
      return true;
    }
    
    // If it has a class that indicates it's from the current user, it's not from the other user
    if (patterns.fromMeClasses.has(cls)) {
      return false;
    }
  }
  
  // If we couldn't determine by class, try by position/style
  const computedStyle = window.getComputedStyle(messageElement);
  if (computedStyle.textAlign === 'left' || 
      computedStyle.alignSelf === 'flex-start' || 
      computedStyle.marginRight === 'auto') {
    return true;
  }
  
  // If it has avatar or name elements that are typically shown for other users
  if (messageElement.querySelector('.avatar') || 
      messageElement.querySelector('.user-name') || 
      messageElement.querySelector('[class*="avatar"]') ||
      messageElement.querySelector('[class*="userName"]')) {
    return true;
  }
  
  // Default: assume it's not from the other user if we can't determine
  return false;
}

function extractMessageText(messageElement) {
  // Try various selectors to find the text content
  for (const selector of [
    '.message-text', '.message-content', '.text-content',
    '[class*="messageText"]', '[class*="content"]',
    'p', '.bubble-content', 'div'
  ]) {
    const textElement = messageElement.querySelector(selector);
    if (textElement && textElement.textContent.trim()) {
      return textElement.textContent.trim();
    }
  }
  
  // If no specific text element found, use the message element's text
  return messageElement.textContent.trim();
}

function getChatHistory(messages, patterns, maxMessages) {
  const history = [];
  const count = Math.min(messages.length, maxMessages);
  
  for (let i = messages.length - count; i < messages.length; i++) {
    const message = messages[i];
    const isFromYou = !isOtherUserMessage(message, patterns);
    const text = extractMessageText(message);
    
    history.push({
      role: isFromYou ? 'assistant' : 'user',
      content: text
    });
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
      <p class="waiting-message">Waiting for new messages...</p>
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
  
  // Try multiple selectors for the input field
  const possibleInputSelectors = [
    '.chat-input textarea', '.chat-input input',
    'textarea[placeholder*="message"]', 'input[placeholder*="message"]',
    'textarea[aria-label*="message"]', 'input[aria-label*="message"]',
    '[contenteditable="true"]', '[role="textbox"]',
    'textarea', 'input[type="text"]'
  ];
  
  let inputField = null;
  
  for (const selector of possibleInputSelectors) {
    inputField = document.querySelector(selector);
    if (inputField) {
      debug('Found input field with selector:', selector);
      break;
    }
  }
  
  if (inputField) {
    // Handle different types of input fields
    if (inputField.getAttribute('contenteditable') === 'true') {
      // For contenteditable divs
      inputField.innerHTML = text;
      // Trigger input event
      const inputEvent = new Event('input', { bubbles: true });
      inputField.dispatchEvent(inputEvent);
    } else {
      // For regular input/textarea
      inputField.value = text;
      // Focus the input field
      inputField.focus();
      // Trigger input event
      const inputEvent = new Event('input', { bubbles: true });
      inputField.dispatchEvent(inputEvent);
    }
    
    debug('Successfully inserted suggestion');
  } else {
    debug('Could not find input field with any selector');
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