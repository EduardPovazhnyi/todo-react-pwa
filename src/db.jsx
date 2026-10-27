import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";

export const db = new Dexie("todo-photos");

db.version(1).stores({
  photos: "id",
});

export async function addPhoto(id, imgSrc) {
  await db.photos.put({ id, imgSrc });
}

export function usePhotoSrc(id) {
  return useLiveQuery(
    () => db.photos.get(id),
    [id]
  )?.imgSrc;
}