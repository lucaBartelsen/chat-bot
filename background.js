// Enhanced background.js with RAG using vector embeddings

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
    
    getSuggestionsFromOpenAI(request.message, request.chatHistory, !!request.regenerate)
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

// Handle importing conversations
async function handleImportConversations(conversations) {
  debug('Handling import of', conversations.length, 'conversations');
  
  try {
    // First, get existing conversations
    const data = await chrome.storage.local.get(['storedConversations']);
    let storedConversations = data.storedConversations || [];
    
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
  debug('Storing conversation from import');
  
  try {
    // Generate embedding for the fan message
    const messageEmbedding = await getEmbedding(fanMessage);
    
    return {
      fanMessage,
      creatorResponse,
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
    
    // Calculate similarity scores
    const withSimilarity = storedConversations.map(convo => ({
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
    'writingStyle'
  ]);
  
  const apiKey = data.openaiApiKey;
  const modelName = data.modelName || 'gpt-3.5-turbo';
  const writingStyle = data.writingStyle || '';
  
  debug('Using model:', modelName);
  debug('Writing style configured:', writingStyle ? 'Yes' : 'No');
  
  if (!apiKey) {
    debug('API key not set');
    throw new Error('OpenAI API key not set. Please go to extension options to set it.');
  }
  
  try {
    // NEW: Find similar past conversations using vector search
    const similarConversations = await findSimilarConversations(message);
    debug('Similar conversations found:', similarConversations.length);
    
    // Create base system prompt
    let systemPrompt = 'You are a helpful assistant that generates engaging and personalized responses for FanFix chats. Create 5 different suggested responses that are authentic, conversational, and likely to keep the conversation going. Make the responses varied in tone and length.';
    
    // If this is a regenerate request, add instructions for more variety
    if (isRegenerate) {
      systemPrompt += '\n\nIMPORTANT: This is a regeneration request. Please provide completely different suggestions than before with varied approaches and tones.';
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
        systemPrompt += `\nYou: "${convo.creatorResponse}"`;
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
      content: `Please suggest 3 different responses to this message: "${message}"`
    });
    
    debug('Sending request to OpenAI with messages:', messages);
    
    const temperature = isRegenerate ? 1.0 : 0.7;
    
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
        temperature: temperature,
        max_tokens: 300
      })
    });

    clearTimeout(timeoutId);
    
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
    clearTimeout(timeoutId);
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