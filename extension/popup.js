// popup.js - Script for the popup

document.addEventListener('DOMContentLoaded', function() {
  const statusEl = document.getElementById('status');
  const optionsBtn = document.getElementById('optionsBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  
  // Check if API key is configured
  chrome.storage.sync.get(['openaiApiKey'], function(data) {
    if (data.openaiApiKey) {
      statusEl.textContent = 'Ready to provide suggestions!';
      statusEl.style.backgroundColor = '#e6f4ea';
    } else {
      statusEl.textContent = 'API key not configured. Please visit the options page.';
      statusEl.style.backgroundColor = '#fce8e6';
    }
  });
  
  // Add event listeners to buttons
  optionsBtn.addEventListener('click', function() {
    chrome.runtime.openOptionsPage();
  });
  
  refreshBtn.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: 'refresh'}, function(response) {
        if (chrome.runtime.lastError) {
          console.log('Error sending refresh message:', chrome.runtime.lastError);
        } else {
          console.log('Refresh response:', response);
        }
      });
    });
  });
});