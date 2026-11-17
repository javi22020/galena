import { api } from '../api'
import { useStore } from '../store'
import { Modal } from './Modal'

/** An image of the vault, opened from the explorer. */
export function ImageView() {
  const path = useStore((s) => s.imageFile)
  return (
    <Modal name="image" title={path ?? 'Image'} className="sm:max-w-4xl">
      <div className="min-h-0 overflow-auto p-4">
        {path && <img src={api.imageUrl(path)} alt={path} className="mx-auto max-w-full" />}
      </div>
    </Modal>
  )
}
