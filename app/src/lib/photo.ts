import { sb } from './supabase'
import { must } from './ui'

// Фото сжимается в браузере до 640 px (JPEG) — быстро грузится и не занимает место.
async function shrink(file: File, max = 640): Promise<Blob> {
  const img = await createImageBitmap(file).catch(() => {
    throw new Error('Не удалось открыть фото. Выберите JPG или PNG')
  })
  const k = Math.min(1, max / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('Не удалось обработать фото'))), 'image/jpeg', 0.85))
}

// staff — публичная ссылка (сохраняется в profiles.photo_url); students — путь в закрытой корзине (students.photo_path).
export async function uploadPhoto(bucket: 'staff' | 'students', owner: string, file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Выберите фото')
  const path = `${owner}/${Date.now()}.jpg`
  must(await sb.storage.from(bucket).upload(path, await shrink(file), { contentType: 'image/jpeg' }))
  return bucket === 'staff' ? sb.storage.from('staff').getPublicUrl(path).data.publicUrl : path
}

// Временная ссылка на фото ученика (корзина закрыта, права — как у карточки ученика).
export async function studentPhotoUrl(path: string | null) {
  if (!path) return null
  const { data } = await sb.storage.from('students').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}
