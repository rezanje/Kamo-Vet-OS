import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PetPhotoUpload } from '../PetPhotoUpload';
it('retains the saved photo while hiding patient-master upload controls during correction', () => {
  const html = renderToStaticMarkup(<PetPhotoUpload petId="pet" initialUrl="/saved-photo.png" readOnly />);
  expect(html).toContain('src="/saved-photo.png"');
  expect(html).not.toContain('type="file"');
  expect(html).not.toContain('Ubah foto');
});
it('keeps the existing editable patient photo input for initial examinations', () => {
  expect(renderToStaticMarkup(<PetPhotoUpload petId="pet" initialUrl={null} />)).toContain('type="file"');
});
