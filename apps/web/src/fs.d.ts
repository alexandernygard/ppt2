// File System Access API (Chromium). Declared here because lib.dom only has part of it.

interface FilePickerType { description?: string; accept: Record<string, string[]> }

interface Window {
  showOpenFilePicker?: (options?: { types?: FilePickerType[]; multiple?: boolean; id?: string }) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (options?: { suggestedName?: string; types?: FilePickerType[]; id?: string }) => Promise<FileSystemFileHandle>
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>
}

interface FileSystemHandle {
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>
}
