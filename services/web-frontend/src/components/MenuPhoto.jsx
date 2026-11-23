import { useState } from 'react';

export const DEFAULT_MENU_IMAGE = '/images/defaults/menu-placeholder.svg';

export default function MenuPhoto({ imageUrl }) {
  const [failedImageUrl, setFailedImageUrl] = useState(null);
  const requestedImageUrl =
    typeof imageUrl === 'string' && imageUrl.trim() ? imageUrl : null;
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
