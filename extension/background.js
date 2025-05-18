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
    
    // Build the system prompt for the Responses API following the new format
    let instructions = `# Role and Objective
You are an AI assistant for the FanFix platform that creates personalized response suggestions for creators to send to their fans. Your goal is to help creators maintain engaging conversations by generating ${numSuggestions} natural-sounding replies that match their personal writing style.

# Instructions
* Generate exactly ${numSuggestions} different response options
* STRONGLY PREFER multi-message responses (2-3 connected messages) over single messages
* Look for natural breaking points in longer responses (after emojis, between thoughts, questions)
* Split messages that contain multiple thoughts, questions, or tone shifts
* Match the creator's writing style precisely as described

## Message Splitting Guidelines
* Split messages at natural breaks:
  - After emojis
  - Between a statement and a question
  - When changing topics or emotional tone
  - Where a person would naturally pause when typing
* Example split: "oh wow u really know how to push me huh 😅" + "what do u wanna know? im an open book for u"
* For most responses, aim for 2-3 connected messages rather than one long message

## Writing Style Implementation
* Precisely follow the provided writing style: ${writingStyle || "friendly, conversational, and authentic"}
* Pay special attention to:
  - Capitalization patterns (all lowercase, selective caps)
  - Text shortcuts (u/ur/omg/etc.)
  - Emoji usage (frequency, placement, specific sets)
  - Punctuation style (spaces, multiple !!, etc.)
  - Sentence structure and length
  - Question style and frequency

# Reasoning Steps
1. Analyze the fan's message for content, tone, and question types
2. Review chat history to understand conversation context
3. Draft responses that maintain the relationship's current vibe
4. ACTIVELY look for places to split messages for natural conversation flow
5. Apply the creator's exact writing style patterns
6. Ensure all suggestions offer different approaches/content

# Output Format
Return ONLY valid JSON following this structure:
\`\`\`
{
  "suggestions": [
    {
      "type": "multi",
      "messages": ["First message here 😅", "Second message continues the thought"]
    },
    {
      "type": "multi",
      "messages": ["Another approach", "With follow-up", "Maybe a third"]
    }
  ]
}
\`\`\``;
// Add any examples from similar conversations here
if (similarConversations.length > 0) {
  similarConversations.forEach((convo, index) => {
    instructions += `
## Example ${index + 1}
### Fan Message
"${convo.fanMessage}"

### Creator Response
${convo.creatorResponses.map(msg => `"${msg}"`).join('\n')}
`;
  });
}

instructions += `
# Final Instructions
When generating responses:
${isRegenerate ? '* This is a regeneration request - provide COMPLETELY DIFFERENT suggestions than before\n' : ''}
* Always prioritize multi-message format (2-3 messages) over single messages
* Keep individual messages relatively short and conversational
* Include questions to engage the fan when appropriate
* Make each message feel like part of a natural typing flow
* Apply all style elements consistently (capitalization, shortcuts, emoji usage)
* Match fan energy while gently steering toward deeper conversation

Return only the JSON response with no additional text.`;
    
    debug('Using system prompt:', instructions);
    
    // Format the chat history in the correct input structure for the Responses API
    const formattedInput = [];
    formattedInput.push({
          role: "system",
          content: `Create ${numSuggestions} different suggested responses to the fan's message in the given JSON format.`
        });
    
    // Add chat history to the input
    if (chatHistory && chatHistory.length > 0) {
      for (const entry of chatHistory) {
        formattedInput.push({
          role: entry.role,
          content: entry.content
        });
      }
    }
    
    // Add the latest message to respond to
    formattedInput.push({
      role: "user",
      content: message
    });
    
    debug('Formatted input with chat history:', formattedInput);
    
    debug('Preparing request for OpenAI Responses API');
    
    // Use a lower temperature for more consistent adherence to the prompt format
    // Base temperature is lower to ensure format compliance, but still allow for some variety
    const baseTemperature = 0.4;
    // If regenerate is requested, add a small increment for more variety
    const temperature = isRegenerate ? baseTemperature + 0.3 : baseTemperature;
    
    // Prepare the payload for the Responses API
    const requestPayload = {
      model: modelName,
      instructions,
      input: formattedInput,
      temperature: temperature,
      max_output_tokens: 600,
      user: "fanfix-extension-user",
      text: { format: { type: "json_object" } }
    };
    
    debug('Sending request to OpenAI Responses API:', requestPayload);
    
    // Make API request using the new Responses API
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'responses=v1'  // Required header for Responses API
      },
      body: JSON.stringify(requestPayload)
    });
    
    const responseStatus = response.status;
    debug('Response status:', responseStatus);
    
    if (!response.ok) {
      const errorData = await response.json();
      debug('API error response:', errorData);
      throw new Error(errorData.error?.message || `Error calling OpenAI Responses API: ${responseStatus}`);
    }
    
    // Parse the response from the Responses API
    const data = await response.json();
    debug('API response data:', data);

    // Extract content from the Responses API format
    let content = '';
    if (data.output && 
        Array.isArray(data.output) && 
        data.output[0]?.content && 
        Array.isArray(data.output[0].content) &&
        data.output[0].content[0]?.text) {
        
        content = data.output[0].content[0].text.trim();
    } else if (data.content) {
        // Fallback to old format if available
        content = data.content;
    }

    debug('Extracted content:', content);
    
    // Parse the suggestions from the response
    const suggestions = parseResponses(content, numSuggestions);
    
    function ensureMultiMessageFormat(suggestions) {
      return suggestions.map(suggestion => {
        // Convert any suggestions that aren't explicitly typed as "multi" to use multi-message format
        if (suggestion.type !== 'multi') {
          return {
            type: 'multi',  // Force type to be 'multi'
            messages: Array.isArray(suggestion.messages) ? suggestion.messages : [suggestion.messages]
          };
        }
        return suggestion;
      });
    }
    
    return ensureMultiMessageFormat(suggestions);
  } catch (error) {
    debug('OpenAI API error:', error);
    throw error;
  }
}

function parseResponses(content, requestedCount = 3) {
  debug('Parsing response content:', content);
  let suggestions = [];
  
  try {
    // First check if the content is a JSON string wrapped in quotes
    if (typeof content === 'string' && content.trim().startsWith('"') && content.trim().endsWith('"')) {
      // Remove outer quotes and unescape inner quotes
      const unescapedContent = JSON.parse(content);
      
      // Now parse the inner JSON
      if (typeof unescapedContent === 'string') {
        const jsonResponse = JSON.parse(unescapedContent);
        
        if (jsonResponse.suggestions && Array.isArray(jsonResponse.suggestions)) {
          suggestions = jsonResponse.suggestions
            .filter(s => s && (s.type === 'single' || s.type === 'multi'))
            .filter(s => Array.isArray(s.messages) && s.messages.length > 0)
            .slice(0, requestedCount);
          
          debug('Successfully parsed double-encoded JSON suggestions:', suggestions.length);
          return suggestions; // Return early since we've successfully parsed
        }
      }
    }
    
    // Try standard JSON parsing as before
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