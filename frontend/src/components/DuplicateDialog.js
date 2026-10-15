import React from 'react';

const cardStyles =
  'bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm';

/**
 * Warns about file names that already exist in the archive before any of
 * the selected files start uploading. Rendered from the shared upload
 * queue store, so every upload path shows the same dialog.
 */
export default function DuplicateDialog({ names, onChoose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => onChoose('cancel')} />
      <div className={`${cardStyles} relative w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto`}>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Already in the archive</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {names.length === 1
            ? `\"${names[0]}\" has already been uploaded.`
            : `${names.length} of the selected files have already been uploaded:`}
        </p>
        {names.length > 1 && (
          <ul className="text-sm max-h-40 overflow-y-auto space-y-1 text-gray-700 dark:text-gray-200">
            {names.map((n) => (
              <li key={n} className="truncate" title={n}>{n}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Uploading anyway creates a second copy of the document.
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => onChoose('cancel')}
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onChoose('anyway')}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl"
          >
            Upload anyway
          </button>
          <button
            type="button"
            onClick={() => onChoose('skip')}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-xl"
          >
            Skip duplicates
          </button>
        </div>
      </div>
    </div>
  );
}
