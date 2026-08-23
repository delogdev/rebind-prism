/**
 * The whole surface the page is allowed to touch.
 *
 * Nothing is passed through generically — every call below is a named
 * capability with a fixed shape, so widening what the renderer can do means
 * editing this file and main.cjs together.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('prism', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onState: (fn) => {
      const handler = (_e, state) => fn(state)
      ipcRenderer.on('window:state', handler)
      return () => ipcRenderer.off('window:state', handler)
    }
  },
  file: {
    open: (filters) => ipcRenderer.invoke('file:open', filters),
    save: (payload) => ipcRenderer.invoke('file:save', payload),
    saveBytes: (payload) => ipcRenderer.invoke('file:saveBytes', payload)
  },
  workspace: {
    autosave: (text) => ipcRenderer.invoke('workspace:autosave', text),
    restore: () => ipcRenderer.invoke('workspace:restore'),
    forget: () => ipcRenderer.invoke('workspace:forget'),
    saveAs: (payload) => ipcRenderer.invoke('workspace:saveAs', payload)
  },
  cookies: {
    list: () => ipcRenderer.invoke('cookies:list'),
    clear: () => ipcRenderer.invoke('cookies:clear'),
    remove: (which) => ipcRenderer.invoke('cookies:remove', which)
  },
  http: {
    send: (spec) => ipcRenderer.invoke('http:send', spec)
  },
  shell: {
    open: (url) => ipcRenderer.invoke('shell:open', url)
  }
})
