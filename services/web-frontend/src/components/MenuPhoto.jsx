import { useState } from 'react';
import { menuImage, DEFAULT_MENU_IMAGE } from '../menuImages.js';

export { DEFAULT_MENU_IMAGE } from '../menuImages.js';

export default function MenuPhoto({ imageUrl, name }) {
  const [failedImageUrl, setFailedImageUrl] = useState(null);
  const requestedImageUrl = menuImage({ imageUrl, name });
  const source =
    requestedImageUrl && failedImageUrl !== requestedImageUrl
      ? requestedImageUrl
      : DEFAULT_MENU_IMAGE;

  return (
    <img
      src={source}
      alt=""
      onError={() => {
        if (requestedImageUrl && source === requestedImageUrl) {
          setFailedImageUrl(requestedImageUrl);
        }
      }}
    />
  );
}
