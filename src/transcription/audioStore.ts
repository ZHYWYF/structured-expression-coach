const DATABASE_NAME = "yanxu-audio-assets";
const STORE_NAME = "audio";
const VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开音频存储"));
  });
}

export async function saveAudioFile(id: string, file: File): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(file, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("音频保存失败"));
  });
  database.close();
}

export async function loadAudioFile(id: string): Promise<File | null> {
  const database = await openDatabase();
  const value = await new Promise<Blob | File | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as Blob | File | undefined);
    request.onerror = () => reject(request.error ?? new Error("音频读取失败"));
  });
  database.close();
  if (!value) return null;
  return value instanceof File ? value : new File([value], "audio", { type: value.type });
}

export async function deleteAudioFile(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("音频删除失败"));
  });
  database.close();
}
