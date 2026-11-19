import { useEffect } from 'react';
import { useMenuRequest } from '../useMenuRequests.js';
import MenuDetail from './MenuDetail.jsx';

export default function RemoteMenuDetail({ api, menuId, onLoaded, ...props }) {
  const result = useMenuRequest(
    menuId,
    (signal) => api.detail(menuId, { signal }),
    [api, menuId],
  );
  useEffect(() => {
    if (result.data) onLoaded(result.data);
  }, [result.data, onLoaded]);
  return (
    <MenuDetail
      {...props}
      menu={result.data}
      loading={result.loading}
      failure={result.error?.message}
      onRetry={result.retry}
    />
  );
}
