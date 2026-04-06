import { useCallback, useRef } from 'react';
import { useLocale } from '../../context/LocaleContext';

interface DateNavProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  timezone?: string;
  /** Hide the "Today" button */
  hideToday?: boolean;
}

export function DateNav({ selectedDate, onDateChange, timezone = 'Europe/Istanbul', hideToday }: DateNavProps) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);

  const dateKey = selectedDate.toLocaleDateString('en-CA', { timeZone: timezone });
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const isToday = dateKey === todayKey;

  const formattedDate = selectedDate.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  });

  const goBack = useCallback(() => {
    onDateChange(new Date(selectedDate.getTime() - 24 * 60 * 60 * 1000));
  }, [selectedDate, onDateChange]);

  const goForward = useCallback(() => {
    onDateChange(new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000));
  }, [selectedDate, onDateChange]);

  const goToday = useCallback(() => {
    onDateChange(new Date());
  }, [onDateChange]);

  const handlePickerChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const [y, m, d] = val.split('-').map(Number);
    const picked = new Date(y, m - 1, d, 12, 0, 0);
    onDateChange(picked);
  }, [onDateChange]);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={goBack}
        className="text-gray-400 hover:text-gray-200 px-1 text-lg leading-none"
      >
        &#8249;
      </button>
      <button
        onClick={() => inputRef.current?.showPicker()}
        className="text-xs text-gray-300 min-w-[110px] text-center select-none hover:text-primary-300 cursor-pointer transition-colors"
        title={t('common.pickDate')}
      >
        {formattedDate}
      </button>
      <input
        ref={inputRef}
        type="date"
        value={dateKey}
        onChange={handlePickerChange}
        className="sr-only"
        tabIndex={-1}
      />
      <button
        onClick={goForward}
        className="text-gray-400 hover:text-gray-200 px-1 text-lg leading-none"
      >
        &#8250;
      </button>
      {!hideToday && !isToday && (
        <button
          onClick={goToday}
          className="text-xs text-primary-400 hover:text-primary-300 transition-colors ml-1"
        >
          {t('common.today')}
        </button>
      )}
    </div>
  );
}
