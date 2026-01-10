/**
 * Country Field Component
 * 
 * Country selector with flags and search.
 */

import { useState, useRef, useEffect } from 'preact/hooks';
import type { FieldDefinition } from '@1cc/shared';

interface CountryFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: CountryValue | null) => void;
  error?: string;
  disabled?: boolean;
}

interface CountryValue {
  code: string;
  name: string;
  dialCode?: string;
  flag?: string;
}

// Common countries list with ISO codes
const COUNTRIES: CountryValue[] = [
  { code: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧' },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { code: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸' },
  { code: 'PT', name: 'Portugal', dialCode: '+351', flag: '🇵🇹' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱' },
  { code: 'BE', name: 'Belgium', dialCode: '+32', flag: '🇧🇪' },
  { code: 'CH', name: 'Switzerland', dialCode: '+41', flag: '🇨🇭' },
  { code: 'AT', name: 'Austria', dialCode: '+43', flag: '🇦🇹' },
  { code: 'SE', name: 'Sweden', dialCode: '+46', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', dialCode: '+47', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', dialCode: '+45', flag: '🇩🇰' },
  { code: 'FI', name: 'Finland', dialCode: '+358', flag: '🇫🇮' },
  { code: 'IE', name: 'Ireland', dialCode: '+353', flag: '🇮🇪' },
  { code: 'PL', name: 'Poland', dialCode: '+48', flag: '🇵🇱' },
  { code: 'CZ', name: 'Czech Republic', dialCode: '+420', flag: '🇨🇿' },
  { code: 'JP', name: 'Japan', dialCode: '+81', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', dialCode: '+82', flag: '🇰🇷' },
  { code: 'CN', name: 'China', dialCode: '+86', flag: '🇨🇳' },
  { code: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬' },
  { code: 'HK', name: 'Hong Kong', dialCode: '+852', flag: '🇭🇰' },
  { code: 'TW', name: 'Taiwan', dialCode: '+886', flag: '🇹🇼' },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64', flag: '🇳🇿' },
  { code: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', dialCode: '+52', flag: '🇲🇽' },
  { code: 'AR', name: 'Argentina', dialCode: '+54', flag: '🇦🇷' },
  { code: 'CL', name: 'Chile', dialCode: '+56', flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia', dialCode: '+57', flag: '🇨🇴' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', flag: '🇸🇦' },
  { code: 'IL', name: 'Israel', dialCode: '+972', flag: '🇮🇱' },
  { code: 'EG', name: 'Egypt', dialCode: '+20', flag: '🇪🇬' },
  { code: 'RU', name: 'Russia', dialCode: '+7', flag: '🇷🇺' },
  { code: 'UA', name: 'Ukraine', dialCode: '+380', flag: '🇺🇦' },
  { code: 'TR', name: 'Turkey', dialCode: '+90', flag: '🇹🇷' },
  { code: 'TH', name: 'Thailand', dialCode: '+66', flag: '🇹🇭' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62', flag: '🇮🇩' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾' },
  { code: 'PH', name: 'Philippines', dialCode: '+63', flag: '🇵🇭' },
  { code: 'VN', name: 'Vietnam', dialCode: '+84', flag: '🇻🇳' },
];

export function CountryField({ field, value, onChange, error, disabled }: CountryFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  
  const countryValue = value as CountryValue | null;
  const constraints = field.constraints || {};
  const showFlag = constraints.includeFlag !== false;
  const showDialCode = constraints.includeDialCode === true;
  
  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Filter countries
  const filteredCountries = COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.code.toLowerCase().includes(search.toLowerCase())
  );
  
  function selectCountry(country: CountryValue) {
    const result: CountryValue = {
      code: country.code,
      name: country.name
    };
    if (constraints.includeDialCode) {
      result.dialCode = country.dialCode;
    }
    if (constraints.includeFlag !== false) {
      result.flag = country.flag;
    }
    onChange(result);
    setIsOpen(false);
    setSearch('');
  }
  
  function clearSelection() {
    onChange(null);
  }
  
  return (
    <div ref={containerRef} class="relative">
      {/* Selected country or input */}
      {countryValue ? (
        <div class={`input flex items-center justify-between ${error ? 'border-red-500' : ''} ${disabled ? 'bg-surface-100' : ''}`}>
          <div class="flex items-center gap-2">
            {showFlag && countryValue.flag && (
              <span class="text-xl">{countryValue.flag}</span>
            )}
            <span class="text-surface-900 dark:text-surface-100">{countryValue.name}</span>
            {showDialCode && countryValue.dialCode && (
              <span class="text-surface-500">({countryValue.dialCode})</span>
            )}
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={clearSelection}
              class="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded"
            >
              <span class="i-lucide-x text-surface-400"></span>
            </button>
          )}
        </div>
      ) : (
        <div 
          class={`input flex items-center gap-2 cursor-pointer ${error ? 'border-red-500' : ''} ${disabled ? 'bg-surface-100 cursor-not-allowed' : ''}`}
          onClick={() => !disabled && setIsOpen(true)}
        >
          <span class="i-lucide-globe text-surface-400"></span>
          <span class="text-surface-400">
            {field.placeholder || 'Select a country...'}
          </span>
        </div>
      )}
      
      {/* Dropdown */}
      {isOpen && !disabled && (
        <div class="absolute z-50 w-full mt-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg max-h-60 overflow-hidden">
          {/* Search */}
          <div class="p-2 border-b border-surface-200 dark:border-surface-700">
            <div class="relative">
              <span class="i-lucide-search absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"></span>
              <input
                type="text"
                value={search}
                onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                class="input text-sm pl-9"
                placeholder="Search countries..."
                autoFocus
              />
            </div>
          </div>
          
          {/* Country list */}
          <div class="overflow-y-auto max-h-48">
            {filteredCountries.length > 0 ? (
              filteredCountries.map(country => (
                <button
                  key={country.code}
                  type="button"
                  onClick={() => selectCountry(country)}
                  class="w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-50 dark:hover:bg-surface-700"
                >
                  {showFlag && <span class="text-xl">{country.flag}</span>}
                  <span class="flex-1 text-surface-900 dark:text-surface-100">{country.name}</span>
                  <span class="text-surface-500 text-xs">{country.code}</span>
                  {showDialCode && (
                    <span class="text-surface-400 text-xs">{country.dialCode}</span>
                  )}
                </button>
              ))
            ) : (
              <div class="p-3 text-center text-surface-500 text-sm">
                No countries found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
