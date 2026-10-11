import React, { useEffect, useState } from 'react';
import { DocumentIcon } from '@heroicons/react/24/outline';
import { mediaUrl } from '../services/api';

export default function Thumbnail({ document, className = 'w-14 h-14' }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [document.id, document.has_thumbnail]);

  const showImage = document.has_thumbnail && !failed;

  return (
    <div className={`flex-shrink-0 flex items-center justify-center bg-gray-100 rounded-lg overflow-hidden ${className}`}>
      {showImage ? (
        <img
          src={mediaUrl(`/documents/${document.id}/thumbnail`)}
          alt={document.original_filename}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <DocumentIcon className="w-6 h-6 text-gray-400" />
      )}
    </div>
  );
}
