import { useI18n } from '../i18n/react';
import { Picker } from './Picker';

interface GenreFilterProps {
  options: Array<{ name: string; count: number }>;
  selected: string[];
  onChange(next: string[]): void;
}

/** Multi-select genre filter. A genre in the URL matches its option whatever the case. */
export function GenreFilter({ options, selected, onChange }: GenreFilterProps) {
  const i18n = useI18n();
  const names = new Map(options.map((option) => [option.name.toLowerCase(), option.name]));

  return (
    <Picker
      multiple
      label={i18n.t('genre.title')}
      buttonLabel={i18n.t('genre.button')}
      clearLabel={i18n.t('genre.clear')}
      options={options.map((option) => ({ value: option.name, label: i18n.genre(option.name), detail: i18n.number(option.count) }))}
      value={selected.map((genre) => names.get(genre.toLowerCase()) ?? genre)}
      onChange={onChange}
      disabled={!options.length}
    />
  );
}
