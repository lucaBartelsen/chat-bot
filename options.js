document.addEventListener('DOMContentLoaded', function() {
  const apiKeyInput = document.getElementById('apiKey');
  const assistantIdInput = document.getElementById('assistantId');
  const saveBtn = document.getElementById('saveBtn');
  const createAssistantBtn = document.getElementById('createAssistantBtn');
  const statusEl = document.getElementById('status');
  
  // Load saved settings
  chrome.storage.sync.get(['openaiApiKey', 'assistantId'], function(data) {
    if (data.openaiApiKey) {
      apiKeyInput.value = data.openaiApiKey;
    }
    
    if (data.assistantId) {
      assistantIdInput.value = data.assistantId;
    }
  });
  
  // Save settings when the button is clicked
  saveBtn.addEventListener('click', function() {
    const apiKey = apiKeyInput.value.trim();
    const assistantId = assistantIdInput.value.trim();
    
    // Validate API key format
    if (!apiKey || !apiKey.startsWith('sk-')) {
      showStatus('Please enter a valid OpenAI API key starting with "sk-"', 'error');
      return;
    }
    
    // Validate Assistant ID format if provided
    if (assistantId && !assistantId.startsWith('asst_')) {
      showStatus('Assistant ID should start with "asst_"', 'error');
      return;
    }
    
    // Save settings
    chrome.storage.sync.set({
      openaiApiKey: apiKey,
      assistantId: assistantId
    }, function() {
      showStatus('Settings saved successfully!', 'success');
    });
  });
  
  // Create a new Assistant
  createAssistantBtn.addEventListener('click', async function() {
    const apiKey = apiKeyInput.value.trim();
    
    // Validate API key
    if (!apiKey || !apiKey.startsWith('sk-')) {
      showStatus('Please enter a valid OpenAI API key first', 'error');
      return;
    }
    
    showStatus('Creating new Assistant...', '');
    
    try {
      // Call OpenAI API to create a new Assistant
      const response = await fetch('https://api.openai.com/v1/assistants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'assistants=v2'
        },
        body: JSON.stringify({
          name: 'FanFix Chat Assistant',
          instructions: 'You are a helpful assistant that generates engaging and personalized responses for FanFix chats. Create 3 different suggested responses that are authentic, conversational, and likely to keep the conversation going. Make the responses varied in tone and length. Number each response as 1, 2, and 3.',
          model: 'gpt-4-turbo-preview', // Using GPT-4 Turbo for best results
          tools: [] // No tools needed for this use case
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `Error creating Assistant: ${response.status}`);
      }
      
      const data = await response.json();
      const newAssistantId = data.id;
      
      // Update the input field with the new Assistant ID
      assistantIdInput.value = newAssistantId;
      
      // Save to storage
      chrome.storage.sync.set({
        assistantId: newAssistantId
      }, function() {
        showStatus(`Assistant created successfully! ID: ${newAssistantId}`, 'success');
      });
      
    } catch (error) {
      console.error('Error creating Assistant:', error);
      showStatus(`Error creating Assistant: ${error.message}`, 'error');
    }
  });
  
  function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
    statusEl.style.display = 'block';
    
    // Hide the status message after 3 seconds if it's a success or error
    if (type === 'success' || type === 'error') {
      setTimeout(function() {
        statusEl.style.display = 'none';
      }, 3000);
    }
  }
});