chrome.devtools.panels.create('Re-renders', 'icons/icon16.png', 'panel.html');
chrome.devtools.panels.elements.createSidebarPane('Re-renders', (pane) => {
  pane.setPage('sidebar.html');
});
