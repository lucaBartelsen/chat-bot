// Improved background.js with Assistant API integration

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
    
    getSuggestionsFromAssistant(request.message, request.chatHistory)
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

async function getSuggestionsFromAssistant(message, chatHistory) {
  debug('Fetching suggestions from OpenAI Assistant');
  
  // Get API key and assistant ID from storage
  const data = await chrome.storage.sync.get(['openaiApiKey', 'assistantId']);
  const apiKey = data.openaiApiKey;
  const assistantId = data.assistantId;
  
  debug('Using Assistant ID:', assistantId);
  
  if (!apiKey) {
    debug('API key not set');
    throw new Error('OpenAI API key not set. Please go to extension options to set it.');
  }
  
  if (!assistantId) {
    debug('Assistant ID not set');
    throw new Error('OpenAI Assistant ID not set. Please go to extension options to set it.');
  }
  
  try {
    // Step 1: Create a new thread
    debug('Creating new thread');
    const threadResponse = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({})
    });
    
    if (!threadResponse.ok) {
      const errorData = await threadResponse.json();
      debug('Thread creation error:', errorData);
      throw new Error(errorData.error?.message || `Error creating thread: ${threadResponse.status}`);
    }
    
    const threadData = await threadResponse.json();
    const threadId = threadData.id;
    debug('Thread created with ID:', threadId);
    
    // Step 2: Add chat history and the current message to the thread
    if (chatHistory && chatHistory.length > 0) {
      debug('Adding chat history to thread');
      // Add each message from the chat history to the thread
      for (const historyMessage of chatHistory) {
        await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({
            role: historyMessage.role,
            content: historyMessage.content
          })
        });
      }
    }
    
    // Step 3: Add the latest message with instruction to generate 3 responses
    debug('Adding current message to thread');
    await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        role: 'user',
        content: `Please suggest 3 different responses to this message: "${message}". Make the responses varied in tone and length. Return your suggestions in JSON format as an array of objects, with each object having a "suggestion" property containing the text.`
      })
    });
    
    // Step 4: Run the Assistant on the thread
    debug('Running assistant on thread');
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        assistant_id: assistantId
      })
    });
    
    if (!runResponse.ok) {
      const errorData = await runResponse.json();
      debug('Run creation error:', errorData);
      throw new Error(errorData.error?.message || `Error running assistant: ${runResponse.status}`);
    }
    
    const runData = await runResponse.json();
    const runId = runData.id;
    debug('Run created with ID:', runId);
    
    // Step 5: Poll for the run to complete
    let runStatus = 'queued';
    let attempts = 0;
    const maxAttempts = 30; // Maximum number of polling attempts
    
    while (runStatus !== 'completed' && runStatus !== 'failed' && attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between polls
      
      const statusResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });
      
      if (!statusResponse.ok) {
        const errorData = await statusResponse.json();
        debug('Status check error:', errorData);
        throw new Error(errorData.error?.message || `Error checking run status: ${statusResponse.status}`);
      }
      
      const statusData = await statusResponse.json();
      runStatus = statusData.status;
      debug(`Run status (attempt ${attempts}):`, runStatus);
      
      if (runStatus === 'failed') {
        debug('Run failed:', statusData);
        throw new Error(`Assistant run failed: ${statusData.last_error?.message || 'Unknown error'}`);
      }
    }
    
    if (attempts >= maxAttempts) {
      throw new Error('Timed out waiting for assistant to complete');
    }
    
    // Step 6: Retrieve the messages (the last message will be the assistant's response)
    debug('Retrieving messages from thread');
    const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });
    
    if (!messagesResponse.ok) {
      const errorData = await messagesResponse.json();
      debug('Messages retrieval error:', errorData);
      throw new Error(errorData.error?.message || `Error retrieving messages: ${messagesResponse.status}`);
    }
    
    const messagesData = await messagesResponse.json();
    debug('Retrieved messages:', messagesData);
    
    // The first message in the list should be the assistant's response
    const assistantMessages = messagesData.data.filter(msg => msg.role === 'assistant');
    
    if (assistantMessages.length === 0) {
      throw new Error('No assistant response found');
    }
    
    const assistantResponse = assistantMessages[0];
    
    // Parse the content from the assistant's response
    let responseContent = '';
    let suggestions = [];
    
    if (assistantResponse.content && assistantResponse.content.length > 0) {
      // In v2, content is an array of content blocks, typically with type = "text"
      responseContent = assistantResponse.content
        .filter(item => item.type === 'text')
        .map(item => item.text.value)
        .join('\n');
      
      debug('Assistant response content:', responseContent);
      
      // Try to parse as JSON
      try {
        const jsonData = JSON.parse(responseContent);
        
        // Check if it's an array of suggestions
        if (Array.isArray(jsonData)) {
          suggestions = jsonData.map(item => {
            // Handle different possible formats
            if (typeof item === 'string') {
              return item;
            } else if (item.suggestion) {
              return item.suggestion;
            } else if (item.text) {
              return item.text;
            } else if (item.content) {
              return item.content;
            } else if (item.message) {
              return item.message;
            } else {
              // If we can't find a clear field, stringify the object
              return JSON.stringify(item);
            }
          });
        } 
        // Check if it has a suggestions array property
        else if (jsonData.suggestions && Array.isArray(jsonData.suggestions)) {
          suggestions = jsonData.suggestions.map(item => {
            if (typeof item === 'string') {
              return item;
            } else if (item.suggestion || item.text || item.content || item.message) {
              return item.suggestion || item.text || item.content || item.message;
            } else {
              return JSON.stringify(item);
            }
          });
        }
        // Check for other common formats
        else if (jsonData.responses && Array.isArray(jsonData.responses)) {
          suggestions = jsonData.responses;
        } else if (jsonData.messages && Array.isArray(jsonData.messages)) {
          suggestions = jsonData.messages;
        } else {
          // As a last resort, try to extract properties from the object
          suggestions = Object.values(jsonData)
            .filter(val => typeof val === 'string')
            .slice(0, 3);
        }
      } catch (error) {
        debug('Error parsing JSON response:', error);
        // Fall back to text parsing if JSON parsing fails
        suggestions = parseResponses(responseContent);
      }
    }
    
    // If we still don't have suggestions, fall back to the original parsing method
    if (suggestions.length === 0) {
      suggestions = parseResponses(responseContent);
    }
    
    debug('Final parsed suggestions:', suggestions);
    return suggestions;
  } catch (error) {
    debug('OpenAI Assistant API error:', error);
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