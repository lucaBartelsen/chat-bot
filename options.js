document.addEventListener('DOMContentLoaded', function() {
  const apiKeyInput = document.getElementById('apiKey');
  const modelNameSelect = document.getElementById('modelName');
  const writingStyleTextarea = document.getElementById('writingStyle');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const embeddingStatsEl = document.getElementById('embeddingStats');
  const clearStoredConversationsBtn = document.getElementById('clearStoredConversationsBtn');
  const exportConversationsBtn = document.getElementById('exportConversationsBtn');
  const importConversationsBtn = document.getElementById('importConversationsBtn');
  const importFileInput = document.getElementById('importFileInput');
  const importProgressContainer = document.getElementById('importProgressContainer');
  const importStatusEl = document.getElementById('importStatus');
  const importProgressBar = document.getElementById('importProgressBar');
  
  // Load saved settings
  chrome.storage.sync.get(['openaiApiKey', 'modelName', 'writingStyle'], function(data) {
    if (data.openaiApiKey) {
      apiKeyInput.value = data.openaiApiKey;
    }
    
    if (data.modelName) {
      modelNameSelect.value = data.modelName;
      
      // If the model isn't in the list, add it
      if (!Array.from(modelNameSelect.options).some(option => option.value === data.modelName)) {
        const option = document.createElement('option');
        option.value = data.modelName;
        option.textContent = data.modelName + ' (Custom)';
        modelNameSelect.appendChild(option);
        modelNameSelect.value = data.modelName;
      }
    }
    
    // Load writing style
    if (data.writingStyle) {
      writingStyleTextarea.value = data.writingStyle;
    }
  });
  
  // Save settings when the button is clicked
  saveBtn.addEventListener('click', function() {
    const apiKey = apiKeyInput.value.trim();
    const modelName = modelNameSelect.value;
    const writingStyle = writingStyleTextarea.value.trim();
    
    // Validate API key format
    if (!apiKey || !apiKey.startsWith('sk-')) {
      showStatus('Please enter a valid OpenAI API key starting with "sk-"', 'error');
      return;
    }
    
    // Save settings
    chrome.storage.sync.set({
      openaiApiKey: apiKey,
      modelName: modelName,
      writingStyle: writingStyle
    }, function() {
      showStatus('Settings saved successfully!', 'success');
    });
  });
  
  function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
    statusEl.style.display = 'block';
    
    // Hide the status message after 3 seconds
    setTimeout(function() {
      statusEl.style.display = 'none';
    }, 3000);
  }
  
  // Add option to add custom model
  const addCustomOption = document.createElement('option');
  addCustomOption.value = 'custom';
  addCustomOption.textContent = '-- Add Custom Model --';
  modelNameSelect.appendChild(addCustomOption);
  
  modelNameSelect.addEventListener('change', function() {
    if (modelNameSelect.value === 'custom') {
      const customModel = prompt('Enter your custom model name:');
      if (customModel && customModel.trim()) {
        const option = document.createElement('option');
        option.value = customModel.trim();
        option.textContent = customModel.trim() + ' (Custom)';
        modelNameSelect.insertBefore(option, addCustomOption);
        modelNameSelect.value = customModel.trim();
      } else {
        modelNameSelect.value = 'gpt-3.5-turbo';
      }
    }
  });
  
  // Get and display embedding system stats
  function updateEmbeddingStats() {
    chrome.storage.local.get(['storedConversations'], function(data) {
      const storedConversations = data.storedConversations || [];
      
      if (storedConversations.length === 0) {
        embeddingStatsEl.innerHTML = 'No stored conversations yet.<br>As you use the chat assistant, it will automatically store conversations to improve future suggestions.';
        return;
      }
      
      // Get the most recent stored conversation
      const mostRecent = new Date(Math.max(...storedConversations.map(c => c.timestamp)));
      const formattedDate = mostRecent.toLocaleString();
      
      embeddingStatsEl.innerHTML = `
        <strong>Stored Conversations:</strong> ${storedConversations.length}<br>
        <strong>Most Recent:</strong> ${formattedDate}<br>
        <strong>Status:</strong> Active and learning from your conversations
      `;
    });
  }
  
  // Update stats when the page loads
  updateEmbeddingStats();
  
  // Clear stored conversations button
  clearStoredConversationsBtn.addEventListener('click', function() {
    if (confirm('Are you sure you want to clear all stored conversations? This cannot be undone.')) {
      chrome.runtime.sendMessage({action: 'clearStoredConversations'}, function(response) {
        if (response && response.success) {
          showStatus('Stored conversations cleared successfully!', 'success');
          updateEmbeddingStats();
        }
      });
    }
  });
  
  // Export conversations button
  exportConversationsBtn.addEventListener('click', function() {
    chrome.storage.local.get(['storedConversations'], function(data) {
      const storedConversations = data.storedConversations || [];
      
      if (storedConversations.length === 0) {
        showStatus('No conversations to export.', 'error');
        return;
      }
      
      // Create a JSON file with the conversations
      const conversationsJson = JSON.stringify(storedConversations, null, 2);
      const blob = new Blob([conversationsJson], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      
      // Create a download link and click it
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fanfix_conversations_' + new Date().toISOString().split('T')[0] + '.json';
      a.click();
      
      // Clean up
      URL.revokeObjectURL(url);
      showStatus('Conversations exported successfully!', 'success');
    });
  });
  
  // Import conversations button
  importConversationsBtn.addEventListener('click', function() {
    importFileInput.click();
  });
  
  // Handle file selection
  importFileInput.addEventListener('change', function(event) {
    const file = event.target.files[0];
    
    if (!file) {
      return;
    }
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
      try {
        const conversations = JSON.parse(e.target.result);
        
        if (!Array.isArray(conversations)) {
          throw new Error('Invalid file format: not an array of conversations');
        }
        
        // Validate conversations
        const validConversations = conversations.filter(convo => 
          convo && 
          typeof convo === 'object' &&
          typeof convo.fanMessage === 'string' &&
          typeof convo.creatorResponse === 'string'
        );
        
        if (validConversations.length === 0) {
          throw new Error('No valid conversations found in the file');
        }
        
        // Start the import process
        startImportProcess(validConversations);
        
      } catch (error) {
        showStatus('Error importing conversations: ' + error.message, 'error');
      }
    };
    
    reader.onerror = function() {
      showStatus('Error reading file', 'error');
    };
    
    reader.readAsText(file);
  });
  
  // Function to start import process
  function startImportProcess(conversations) {
    // Show the import progress container
    importProgressContainer.classList.remove('hidden');
    importStatusEl.textContent = 'Processing conversations...';
    importProgressBar.style.width = '0%';
    
    // First, update conversations that don't have embeddings or timestamps
    let needsEmbeddings = conversations.filter(convo => !convo.embedding);
    
    if (needsEmbeddings.length > 0) {
      importStatusEl.textContent = `Generating embeddings for ${needsEmbeddings.length} conversations...`;
      
      // Send to background script for processing
      chrome.runtime.sendMessage({
        action: 'importConversations',
        conversations: conversations
      }, function(response) {
        if (response && response.success) {
          importStatusEl.textContent = 'Import completed successfully!';
          importProgressBar.style.width = '100%';
          
          // Update stats
          updateEmbeddingStats();
          
          // Hide progress after a delay
          setTimeout(() => {
            importProgressContainer.classList.add('hidden');
            showStatus(`Successfully imported ${conversations.length} conversations!`, 'success');
          }, 2000);
        } else {
          importStatusEl.textContent = 'Error during import: ' + (response?.error || 'Unknown error');
          setTimeout(() => {
            importProgressContainer.classList.add('hidden');
          }, 3000);
        }
      });
      
      // Listen for progress updates
      chrome.runtime.onMessage.addListener(function progressListener(message) {
        if (message.action === 'importProgress') {
          importProgressBar.style.width = message.percent + '%';
          importStatusEl.textContent = message.status;
          
          if (message.percent >= 100) {
            // Remove listener when done
            chrome.runtime.onMessage.removeListener(progressListener);
          }
        }
        return true;
      });
    } else {
      // No embeddings needed, just merge the conversations
      chrome.runtime.sendMessage({
        action: 'importConversations',
        conversations: conversations
      }, function(response) {
        if (response && response.success) {
          importStatusEl.textContent = 'Import completed successfully!';
          importProgressBar.style.width = '100%';
          
          // Update stats
          updateEmbeddingStats();
          
          // Hide progress after a delay
          setTimeout(() => {
            importProgressContainer.classList.add('hidden');
            showStatus(`Successfully imported ${conversations.length} conversations!`, 'success');
          }, 2000);
        } else {
          importStatusEl.textContent = 'Error during import: ' + (response?.error || 'Unknown error');
        }
      });
    }
  }
});