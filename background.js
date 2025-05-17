// Enhanced background.js with multi-message support for vector database

// Enable debugging
const debugMode = true;
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 25000); // 25-second timeout (less than Chrome's limit)


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
  debug('Received message:', request);
  
  if (request.action === 'getSuggestions') {
    debug('Getting suggestions for message:', request.message);
    debug('Chat history:', request.chatHistory);
    debug('Is regenerate request:', !!request.regenerate);
    
    getSuggestionsFromOpenAI(
      request.message, 
      request.chatHistory, 
      !!request.regenerate
    )
      .then(suggestions => {
        debug('Got suggestions:', suggestions);
        sendResponse({ suggestions });
        
        // After successfully generating and sending the suggestions, 
        // store the conversation for future reference if this is not a regenerate request
        if (!request.regenerate && request.chatHistory && request.chatHistory.length > 0) {
          storeNewConversation(request.message, suggestions)
            .catch(err => debug('Error storing conversation:', err));
        }
      })
      .catch(error => {
        debug('Error getting suggestions:', error);
        sendResponse({ error: error.message });
      });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }
  
  else if (request.action === 'clearStoredConversations') {
    chrome.storage.local.remove(['storedConversations'], () => {
      debug('Cleared stored conversations');
      sendResponse({ success: true });
    });
    return true;
  }
  
  else if (request.action === 'importConversations') {
    handleImportConversations(request.conversations)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        debug('Import error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

// Store new conversation when the user selects one of our suggestions
async function storeNewConversation(fanMessage, suggestions) {
  try {
    // We'll only store the first suggestion that was selected
    // Getting the actual selected suggestion would require additional tracking in content.js
    // which could be implemented in the future
    if (!suggestions || suggestions.length === 0) {
      debug('No suggestions to store');
      return;
    }
    
    const chosenSuggestion = suggestions[0]; // Assume first suggestion
    
    // Create conversation object with embedding
    const conversation = await storeConversation(fanMessage, chosenSuggestion);
    
    // Add to stored conversations
    const data = await chrome.storage.local.get(['storedConversations']);
    let storedConversations = data.storedConversations || [];
    
    // Add new conversation
    storedConversations.push(conversation);
    
    // Limit to most recent 1000 conversations
    if (storedConversations.length > 1000) {
      storedConversations = storedConversations
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 1000);
    }
    
    // Save to storage
    await chrome.storage.local.set({ storedConversations });
    debug('Stored new conversation');
  } catch (error) {
    debug('Error storing new conversation:', error);
    throw error;
  }
}

// Handle importing conversations
async function handleImportConversations(conversations) {
  debug('Handling import of', conversations.length, 'conversations');
  
  try {
    // First, get existing conversations
    const data = await chrome.storage.local.get(['storedConversations']);
    let storedConversations = data.storedConversations || [];
    
    // Convert any old format conversations to new format
    conversations = conversations.map(convertToNewFormat);
    
    // Track which conversations need embeddings
    const needEmbeddings = conversations.filter(c => !c.embedding);
    debug('Conversations needing embeddings:', needEmbeddings.length);
    
    // Add timestamp to any conversations that don't have one
    conversations.forEach(c => {
      if (!c.timestamp) {
        c.timestamp = Date.now();
      }
    });
    
    // Generate embeddings for conversations that need them
    if (needEmbeddings.length > 0) {
      let processedCount = 0;
      
      for (const convo of needEmbeddings) {
        try {
          // Send progress update
          const percent = Math.round((processedCount / needEmbeddings.length) * 100);
          chrome.runtime.sendMessage({
            action: 'importProgress',
            percent: percent,
            status: `Generating embeddings: ${processedCount}/${needEmbeddings.length}`
          });
          
          // Generate embedding
          convo.embedding = await getEmbedding(convo.fanMessage);
          processedCount++;
          
        } catch (error) {
          debug('Error generating embedding for a conversation:', error);
          // Continue with the next conversation
          processedCount++;
        }
      }
      
      // Final progress update
      chrome.runtime.sendMessage({
        action: 'importProgress',
        percent: 100,
        status: `Finished generating embeddings for ${processedCount} conversations`
      });
    }
    
    // Merge the imported conversations with existing ones
    const mergedConversations = [...storedConversations, ...conversations];
    
    // Deduplicate based on fan message content
    const uniqueConversations = [];
    const seenMessages = new Set();
    
    for (const convo of mergedConversations) {
      // Only add if we have a valid embedding and haven't seen this message before
      if (convo.embedding && !seenMessages.has(convo.fanMessage)) {
        uniqueConversations.push(convo);
        seenMessages.add(convo.fanMessage);
      }
    }
    
    // Limit to the most recent 1000 conversations
    const limitedConversations = uniqueConversations.sort((a, b) => 
      (b.timestamp || 0) - (a.timestamp || 0)
    ).slice(0, 1000);
    
    // Save the merged conversations
    await chrome.storage.local.set({ storedConversations: limitedConversations });
    
    debug('Successfully imported conversations. New total:', limitedConversations.length);
    return { 
      success: true, 
      totalConversations: limitedConversations.length,
      importedCount: conversations.length
    };
    
  } catch (error) {
    debug('Error importing conversations:', error);
    throw error;
  }
}

// Convert old format (single creatorResponse) to new format (creatorResponses array)
function convertToNewFormat(conversation) {
  if (!conversation) return conversation;
  
  // If already in new format
  if (conversation.creatorResponses) return conversation;
  
  // Convert from old format
  if (conversation.creatorResponse) {
    // Check if the creatorResponse is already a JSON object that should be an array
    if (typeof conversation.creatorResponse === 'object' && !Array.isArray(conversation.creatorResponse)) {
      // Convert object to array of values
      const responses = Object.values(conversation.creatorResponse);
      conversation.creatorResponses = responses;
    } else if (Array.isArray(conversation.creatorResponse)) {
      // Already an array, just rename
      conversation.creatorResponses = conversation.creatorResponse;
    } else {
      // Single string response
      conversation.creatorResponses = [conversation.creatorResponse];
    }
    
    // Delete old property
    delete conversation.creatorResponse;
  } else {
    // No response field at all, create empty array
    conversation.creatorResponses = [];
  }
  
  return conversation;
}

// Get embeddings from OpenAI API
async function getEmbedding(text) {
  debug('Getting embedding for text:', text);
  
  const data = await chrome.storage.sync.get(['openaiApiKey']);
  const apiKey = data.openaiApiKey;
  
  if (!apiKey) {
    throw new Error('OpenAI API key not set. Please go to extension options to set it.');
  }
  
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "text-embedding-ada-002",
        input: text
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Error calling OpenAI Embeddings API: ${response.status}`);
    }
    
    const responseData = await response.json();
    return responseData.data[0].embedding;
  } catch (error) {
    debug('Error getting embedding:', error);
    throw error;
  }
}

// Calculate cosine similarity between two vectors
function calculateCosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Store conversation for future reference
async function storeConversation(fanMessage, creatorResponse) {
  debug('Storing conversation');
  
  try {
    // Generate embedding for the fan message
    const messageEmbedding = await getEmbedding(fanMessage);
    
    // Handle different types of creator responses
    let creatorResponses = [];
    
    if (typeof creatorResponse === 'string') {
      // Single string response
      creatorResponses = [creatorResponse];
    } else if (creatorResponse && creatorResponse.type) {
      // New format with type and messages
      if (creatorResponse.type === 'single') {
        creatorResponses = [creatorResponse.messages[0]];
      } else if (creatorResponse.type === 'multi') {
        creatorResponses = [...creatorResponse.messages];
      }
    } else if (Array.isArray(creatorResponse)) {
      // Array of responses
      creatorResponses = creatorResponse;
    }
    
    return {
      fanMessage,
      creatorResponses,
      embedding: messageEmbedding,
      timestamp: Date.now()
    };
  } catch (error) {
    debug('Error creating conversation object:', error);
    throw error;
  }
}

// Find similar past conversations
async function findSimilarConversations(fanMessage) {
  debug('Finding similar conversations for:', fanMessage);
  
  try {
    // Get embedding for the current message
    const messageEmbedding = await getEmbedding(fanMessage);
    
    // Get stored conversations
    const data = await chrome.storage.local.get(['storedConversations']);
    const storedConversations = data.storedConversations || [];
    
    if (storedConversations.length === 0) {
      debug('No stored conversations found');
      return [];
    }
    
    // Ensure all conversations are in the new format
    const normalizedConversations = storedConversations.map(convertToNewFormat);
    
    // Calculate similarity scores
    const withSimilarity = normalizedConversations.map(convo => ({
      ...convo,
      similarity: calculateCosineSimilarity(messageEmbedding, convo.embedding)
    }));
    
    // Sort by similarity (highest first)
    withSimilarity.sort((a, b) => b.similarity - a.similarity);
    
    // Take the top 3 most similar conversations
    const topSimilar = withSimilarity.slice(0, 3).filter(item => item.similarity > 0.7);
    debug('Found similar conversations:', topSimilar);
    
    return topSimilar;
  } catch (error) {
    debug('Error finding similar conversations:', error);
    // Return empty array on error
    return [];
  }
}

async function getSuggestionsFromOpenAI(message, chatHistory, isRegenerate = false) {
  debug('Fetching suggestions from OpenAI using RAG');
  debug('Is regenerate request:', isRegenerate);
  
  // Get API key and settings from storage
  const data = await chrome.storage.sync.get([
    'openaiApiKey', 
    'modelName',
    'writingStyle',
    'numSuggestions'
  ]);
  
  const apiKey = data.openaiApiKey;
  const modelName = data.modelName || 'gpt-3.5-turbo';
  const writingStyle = data.writingStyle || '';
  const numSuggestions = data.numSuggestions || 3; // Default to 3 if not set
  
  debug('Using model:', modelName);
  debug('Writing style configured:', writingStyle ? 'Yes' : 'No');
  debug('Number of suggestions requested:', numSuggestions);
  
  if (!apiKey) {
    debug('API key not set');
    throw new Error('OpenAI API key not set. Please go to extension options to set it.');
  }
  
  try {
    // Find similar past conversations using vector search
    const similarConversations = await findSimilarConversations(message);
    debug('Similar conversations found:', similarConversations.length);
    
    // Create base system prompt with multi-message support
    let systemPrompt = `You are a helpful assistant that generates engaging and personalized responses for FanFix chats. 

Create ${numSuggestions} different suggested responses. Each suggestion can be either a single message or a sequence of 2-3 connected messages that would be sent in sequence.

Return your suggestions in this exact JSON format:
{
  "suggestions": [
    {
      "type": "single",
      "messages": ["Your complete single message here"]
    },
    {
      "type": "multi",
      "messages": ["First message in sequence", "Second follow-up message", "Optional third message"]
    },
    // Additional suggestions...
  ]
}

Mix both single-message and multi-message suggestions for variety. For multi-message suggestions, make sure each message in the sequence flows naturally from one to the next, as if in a real conversation.`;
    
    // If this is a regenerate request, add instructions for more variety
    if (isRegenerate) {
      systemPrompt += `\n\nIMPORTANT: This is a regeneration request. Please provide ${numSuggestions} completely different suggestions than before with varied approaches and tones.`;
    }
    
    // Add writing style instructions if available
    if (writingStyle && writingStyle.trim()) {
      systemPrompt += `\n\nIMPORTANT: Use the following writing style for all responses: ${writingStyle}`;
    }
    
    // Add similar past conversations as examples if available
    if (similarConversations.length > 0) {
      systemPrompt += '\n\nHere are examples of previous similar conversations that worked well:';
      
      similarConversations.forEach((convo, index) => {
        systemPrompt += `\n\nExample ${index + 1}:`;
        systemPrompt += `\nFan: "${convo.fanMessage}"`;
        
        // Handle multi-message responses
        if (convo.creatorResponses && convo.creatorResponses.length > 0) {
          systemPrompt += `\nYou:`;
          convo.creatorResponses.forEach((response, respIndex) => {
            systemPrompt += `\n  Message ${respIndex + 1}: "${response}"`;
          });
        } else {
          // Fallback for old format or missing responses
          systemPrompt += `\nYou: "(No response recorded)"`;
        }
      });
      
      systemPrompt += '\n\nUse these examples as inspiration for tone, style AND content. You can reuse similar content elements, successful phrases, and themes from the example responses and adapt them to the current context when appropriate.';
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
      content: `Please suggest ${numSuggestions} different responses to this message: "${message}"`
    });
    
    debug('Sending request to OpenAI with messages:', messages);
    
    // Adjust temperature based on whether this is a regenerate request
    const temperature = isRegenerate ? 1.0 : 0.7;
    
    // Make API request with JSON response format
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: messages,
        temperature: temperature,
        max_tokens: 600, // Increased to accommodate more multi-message suggestions
        response_format: { type: "json_object" } // Request JSON response
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
    const suggestions = parseResponses(content, numSuggestions);
    
    return suggestions;
  } catch (error) {
    debug('OpenAI API error:', error);
    throw error;
  }
}

function parseResponses(content, requestedCount = 3) {
  debug('Parsing response content:', content);
  let suggestions = [];
  
  try {
    // Try to parse as JSON
    const jsonResponse = JSON.parse(content);
    
    // Check if the response has a suggestions array
    if (jsonResponse.suggestions && Array.isArray(jsonResponse.suggestions)) {
      // Process each suggestion based on its type
      suggestions = jsonResponse.suggestions
        .filter(s => s && (s.type === 'single' || s.type === 'multi'))
        .filter(s => Array.isArray(s.messages) && s.messages.length > 0)
        .slice(0, requestedCount); // Limit to requested number
      
      debug('Successfully parsed JSON suggestions:', suggestions.length);
    }
  } catch (error) {
    debug('Failed to parse JSON, creating default single-message suggestions:', error);
    
    // Fallback to original logic for backward compatibility
    const numberedRegex = /\d+\.\s+(.*?)(?=\d+\.|$)/gs;
    const matches = [...content.matchAll(numberedRegex)];
    
    if (matches.length >= 2) {
      const textSuggestions = matches.map(match => match[1].trim());
      suggestions = textSuggestions.map(text => ({
        type: 'single',
        messages: [text]
      }));
    } else {
      const textSuggestions = content
        .split(/\n\n+|•\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
        
      suggestions = textSuggestions.map(text => ({
        type: 'single',
        messages: [text]
      }));
    }
  }
  
  // Ensure we have at least one suggestion
  if (suggestions.length < 1) {
    debug('No suggestions parsed, using whole content as a single message');
    suggestions = [{
      type: 'single',
      messages: [content.trim()]
    }];
  }
  
  // Verify all suggestions have the correct structure
  suggestions = suggestions.map(s => {
    // Ensure each suggestion has a valid type
    if (s.type !== 'single' && s.type !== 'multi') {
      s.type = 'single';
    }
    
    // Ensure messages is an array of strings
    if (!Array.isArray(s.messages)) {
      s.messages = [String(s.messages)];
    }
    
    // Remove any quotation marks that might be wrapping individual messages
    s.messages = s.messages.map(m => 
      typeof m === 'string' ? m.replace(/^["'](.*)["']$/s, '$1') : String(m)
    );
    
    return s;
  });
  
  debug('Final parsed suggestions:', suggestions);
  return suggestions;
}