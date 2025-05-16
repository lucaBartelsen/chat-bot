// Improved background.js with writing style customization

// Enable debugging
const debugMode = true;

function debug(message, obj = null) {
  if (!debugMode) return;
  
  if (obj) {
    console.log(`%c[FanFix Background] ${message}`, 'color: #4285f4', obj);
  } else {
    console.log(`%c[FanFix Background] ${message}`, 'color: #4285f4');
  }
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debug('Received message from content script:', request);
  
  if (request.action === 'getSuggestions') {
    debug('Getting suggestions for message:', request.message);
    debug('Chat history:', request.chatHistory);
    
    getSuggestionsFromOpenAI(request.message, request.chatHistory)
      .then(suggestions => {
        debug('Got suggestions:', suggestions);
        sendResponse({ suggestions });
      })
      .catch(error => {
        debug('Error getting suggestions:', error);
        sendResponse({ error: error.message });
      });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }
});

async function getSuggestionsFromOpenAI(message, chatHistory) {
  debug('Fetching suggestions from OpenAI');
  // Get API key and settings from storage
  const data = await chrome.storage.sync.get([
    'openaiApiKey', 
    'modelName',
    'writingStyle'  // New: get writing style preference
  ]);
  
  const apiKey = data.openaiApiKey;
  const modelName = data.modelName || 'gpt-3.5-turbo';
  const writingStyle = data.writingStyle || ''; // Default to empty if not set
  
  debug('Using model:', modelName);
  debug('Writing style configured:', writingStyle ? 'Yes' : 'No');
  
  if (!apiKey) {
    debug('API key not set');
    throw new Error('OpenAI API key not set. Please go to extension options to set it.');
  }
  
  try {
    // Create base system prompt
    let systemPrompt = 'You are a helpful assistant that generates engaging and personalized responses for FanFix chats. Create 3 different suggested responses that are authentic, conversational, and likely to keep the conversation going. Make the responses varied in tone and length.';
    
    // Add writing style instructions if available
    if (writingStyle && writingStyle.trim()) {
      systemPrompt += `\n\nIMPORTANT: Use the following writing style for all responses: ${writingStyle}`;
      debug('Added writing style to prompt');
    }
    
    // Prepare the messages for OpenAI API
    const messages = [
      {
        role: 'system',
        content: systemPrompt
      }
    ];
    
    // Add chat history for context
    if (chatHistory && chatHistory.length > 0) {
      messages.push(...chatHistory);
    }
    
    // Add the latest message to respond to
    messages.push({
      role: 'user',
      content: `Please suggest 3 different responses to this message: "${message}"`
    });
    
    debug('Sending request to OpenAI with messages:', messages);
    
    // Make API request
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: messages,
        temperature: 0.7,
        max_tokens: 300
      })
    });
    
    const responseStatus = response.status;
    debug('Response status:', responseStatus);
    
    if (!response.ok) {
      const errorData = await response.json();
      debug('API error response:', errorData);
      throw new Error(errorData.error?.message || `Error calling OpenAI API: ${responseStatus}`);
    }
    
    const data = await response.json();
    debug('API response data:', data);
    
    // Parse the suggestions from the response
    const content = data.choices[0].message.content;
    const suggestions = parseResponses(content);
    
    return suggestions;
  } catch (error) {
    debug('OpenAI API error:', error);
    throw error;
  }
}

function parseResponses(content) {
  debug('Parsing response content:', content);
  // Split by numbered points (1., 2., 3.) or by double line breaks
  let suggestions = [];
  
  // Try to split by numbered points first
  const numberedRegex = /\d+\.\s+(.*?)(?=\d+\.|$)/gs;
  const matches = [...content.matchAll(numberedRegex)];
  debug('Numbered matches:', matches.length);
  
  if (matches.length >= 2) {
    suggestions = matches.map(match => match[1].trim());
  } else {
    // Fallback: split by double newlines or bullet points
    suggestions = content
      .split(/\n\n+|•\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    debug('Split by newlines/bullets, found:', suggestions.length);
  }
  
  // If we still don't have at least 1 suggestion, just return the whole content
  if (suggestions.length < 1) {
    debug('No suggestions parsed, using whole content');
    suggestions = [content.trim()];
  }
  
  debug('Final parsed suggestions:', suggestions);
  return suggestions;
}