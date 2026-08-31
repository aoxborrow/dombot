import { ipcMain } from 'electron';
import {
  IpcChannels,
  type Folder,
  type FolderInput,
  type FolderPatch,
  type FoldersSnapshot,
} from '../../shared/ipc';
import {
  assignFolder,
  createFolder,
  deleteFolder,
  getFolders,
  updateFolder,
} from '../services/folders';

/** Folder IPC: read the snapshot on launch, plus CRUD and per-domain assignment. */
export function registerFoldersIpc(): void {
  ipcMain.handle(IpcChannels.foldersList, async (): Promise<FoldersSnapshot> =>
    getFolders(),
  );

  ipcMain.handle(
    IpcChannels.foldersCreate,
    async (_e, input: FolderInput): Promise<Folder> => createFolder(input),
  );

  ipcMain.handle(
    IpcChannels.foldersUpdate,
    async (_e, id: string, patch: FolderPatch): Promise<void> => {
      updateFolder(id, patch);
    },
  );

  ipcMain.handle(
    IpcChannels.foldersDelete,
    async (_e, id: string): Promise<void> => {
      deleteFolder(id);
    },
  );

  ipcMain.handle(
    IpcChannels.foldersAssign,
    async (_e, domainKey: string, folderId: string | null): Promise<void> => {
      assignFolder(domainKey, folderId);
    },
  );
}
