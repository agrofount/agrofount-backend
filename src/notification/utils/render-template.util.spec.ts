import { renderTemplate } from './render-template.util';

describe('renderTemplate', () => {
  it('substitutes known {{key}} placeholders with the matching variable', () => {
    expect(
      renderTemplate('Hi {{name}}, welcome to {{place}}!', {
        name: 'Amina',
        place: 'Agrofount',
      }),
    ).toBe('Hi Amina, welcome to Agrofount!');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('Hi {{ name }}!', { name: 'Amina' })).toBe(
      'Hi Amina!',
    );
  });

  it('replaces an unknown placeholder with an empty string', () => {
    expect(renderTemplate('Hi {{name}}, {{missing}}', { name: 'Amina' })).toBe(
      'Hi Amina, ',
    );
  });

  it('returns an empty string for an undefined template', () => {
    expect(renderTemplate(undefined, { name: 'Amina' })).toBe('');
  });
});
