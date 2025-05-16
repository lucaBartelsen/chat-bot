// Improved background.js with Assistant API integration

// Enable debugging
const debugMode = true;

function debug(message, obj = null) {
  if (!debugMode) return;
  
  // Create timestamp in format HH:MM:SS.mmm
  const now = new Date();
  const timestamp = now.toTimeString().split(' ')[0] + '.' + 
                    String(now.getMilliseconds()).padStart(3, '0');
  
  if (obj) {
    console.log(`%c[${timestamp}][FanFix Background] ${message}`, 'color: #4285f4', obj);
  } else {
    console.log(`%c[${timestamp}][FanFix Background] ${message}`, 'color: #4285f4');
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
    // Step 1 & 2 combined: Create a new thread with all chat history messages
    debug('Creating new thread with chat history');
    
    // Map the chat history to the format required by the API
    const messages = chatHistory.map(historyMessage => ({
      role: historyMessage.role,
      content: historyMessage.content
    }));
    
    // Add our instruction as the final message
    messages.push({
      role: 'user',
      content: `Please suggest 3 different responses to this message: "${message}". Make the responses varied in tone and length. Return your suggestions in JSON format as an array of objects, with each object having a "suggestion" property containing the text.`
    });
    
    debug('Prepared messages for thread creation:', messages);
    
    const threadResponse = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        messages: messages
      })
    });
    
    if (!threadResponse.ok) {
      const errorData = await threadResponse.json();
      debug('Thread creation error:', errorData);
      throw new Error(errorData.error?.message || `Error creating thread: ${threadResponse.status}`);
    }
    
    const threadData = await threadResponse.json();
    const threadId = threadData.id;
    debug('Thread created with ID and all messages:', threadId);
    
    // Step 3: Create the run with streaming enabled
    debug('Creating assistant run with streaming');
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        assistant_id: assistantId,
        stream: true
      })
    });
    
    if (!runResponse.ok) {
      // Try to get error details
      try {
        const errorData = await runResponse.json();
        debug('Run creation error details:', errorData);
        throw new Error(errorData.error?.message || `Error creating run: ${runResponse.status}`);
      } catch (parseError) {
        throw new Error(`Error creating run: ${runResponse.status}, couldn't parse error details`);
      }
    }
    
    // Set up streaming response handling directly from the run response
    debug('Processing stream data');
    const reader = runResponse.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let runId = null;
    let responseContent = '';
    let runCompleted = false;
    let streamError = null;
    
    try {
      // Process the stream data
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          debug('Stream complete');
          break;
        }
        
        // Decode the chunk and add to buffer
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // Process completed lines from the buffer
        let lineEnd;
        while ((lineEnd = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, lineEnd);
          buffer = buffer.slice(lineEnd + 1);
          
          if (line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          
          // Extract the data part
          const data = line.substring(6);
          
          // Special case for [DONE]
          if (data === '[DONE]') {
            debug('Received [DONE] event');
            runCompleted = true;
            continue;
          }
          
          try {
            const event = JSON.parse(data);
            debug('Received event:', event);
            debug('Event type:', event.type || event.event || event.object);
            
            // Log the full event structure for debugging
            if (event.delta || (event.data && event.data.delta)) {
              debug('Found delta content in event');
              debug('Delta structure:', event.delta || event.data.delta);
            }
            
            // Extract run ID from the first event if we don't have it yet
            if (!runId && event.id && (event.object === 'thread.run' || event.object === 'run')) {
              runId = event.id;
              debug('Extracted run ID from stream:', runId);
            }
            
            // Process different event types
            if (event.type === 'thread.run.completed' || 
                (event.object === 'thread.run' && event.status === 'completed') ||
                event.event === 'thread.run.completed') {
              debug('Run completed event received');
              runCompleted = true;
            } else if (event.type === 'thread.run.failed' || 
                      (event.object === 'thread.run' && event.status === 'failed') ||
                      event.event === 'thread.run.failed') {
              debug('Run failed event received:', event);
              const errorMsg = event.last_error?.message || event.error?.message || 'Unknown error';
              streamError = new Error(`Assistant run failed: ${errorMsg}`);
              break;
            } else if (event.type === 'thread.message.delta' || event.event === 'thread.message.delta') {
              // Handle content delta events (for V2 streaming format)
              const delta = event.delta || (event.data && event.data.delta);
              if (delta && delta.content) {
                debug('Processing message delta content');
                for (const content of delta.content) {
                  debug('Content item:', content);
                  if (content.type === 'text' && content.text) {
                    if (content.text.value) {
                      debug('Found text value:', content.text.value);
                      responseContent += content.text.value;
                      debug('Added content part, total length now:', responseContent.length);
                    }
                  }
                }
              }
            } else if (event.object === 'thread.message') {
              debug('Thread message event received');
              // Check if this message contains content we can use
              if (event.content && event.content.length > 0) {
                for (const content of event.content) {
                  if (content.type === 'text' && content.text && content.text.value) {
                    const textValue = content.text.value;
                    debug('Found message content text:', textValue);
                    responseContent = textValue;
                    
                    // If this looks like complete JSON with suggestions, process it immediately
                    if (textValue.trim().startsWith('[') && textValue.includes('"suggestion"')) {
                      debug('Content appears to be complete JSON with suggestions, processing immediately');
                      
                      try {
                        const parsedContent = JSON.parse(textValue);
                        if (Array.isArray(parsedContent) && 
                            parsedContent.length > 0 && 
                            parsedContent.every(item => item.suggestion)) {
                          // This is definitely our suggestions in the expected format
                          const earlyResults = parsedContent.map(item => item.suggestion);
                          debug('Early parsed suggestions:', earlyResults);
                          
                          // Return early with these results
                          reader.releaseLock();
                          return earlyResults;
                        }
                      } catch (parseErr) {
                        debug('Early JSON parsing failed:', parseErr);
                        // Continue normal processing if parsing failed
                      }
                    }
                  }
                }
              }
            }
            
            // Log any new message creation events which might contain our answer
            if (event.type === 'thread.message.created' || event.event === 'thread.message.created') {
              debug('Message created event detected');
              if (event.data && event.data.message_id) {
                debug('Message ID from creation event:', event.data.message_id);
              }
            }
          } catch (err) {
            debug('Error parsing event:', err);
            debug('Problem data:', data);
            // Continue processing other events even if one fails
          }
        }
        
        // Break if we got a stream error
        if (streamError) break;
      }
    } catch (err) {
      debug('Stream reading error:', err);
      throw new Error(`Error processing stream: ${err.message}`);
    } finally {
      reader.releaseLock();
    }
    
    // Check if we had a stream error
    if (streamError) {
      throw streamError;
    }
    
    // If streaming didn't provide a run ID, we have a problem
    if (!runId) {
      debug('No run ID was extracted from the stream');
      throw new Error('Could not determine run ID from stream');
    }
    
    // Check if we got complete content
    if (!runCompleted) {
      debug('Stream ended without run completion confirmation');
    }
    
    if (!responseContent) {
      debug('No response content was captured from the stream');
    }
    
    // If streaming didn't work as expected, fall back to fetching messages
    if (!runCompleted || !responseContent) {
      debug('Stream did not provide complete content, falling back to message fetch');
      debug('Run completed status:', runCompleted);
      debug('Response content empty:', !responseContent);
      
      // Wait a moment to make sure the assistant has finished generating the response
      debug('Waiting 2 seconds before fetching messages...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
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
      
      // Extract content from the assistant's response
      if (assistantResponse.content && assistantResponse.content.length > 0) {
        responseContent = assistantResponse.content
          .filter(item => item.type === 'text')
          .map(item => item.text.value)
          .join('\n');
      }
    }
    
    debug('Final response content:', responseContent);
    
    // Process the streamed response content
    debug('Processing streamed response content');
    
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