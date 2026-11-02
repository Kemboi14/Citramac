import { AFRICAN_COUNTRIES, KENYA_COUNTIES, KENYA_SUB_COUNTIES_BY_COUNTY } from "../data/geography";

interface LocationFieldsProps {
  country: string;
  county: string;
  subCounty: string;
  onCountryChange: (value: string) => void;
  onCountyChange: (value: string) => void;
  onSubCountyChange: (value: string) => void;
  labelClassName: string;
  fieldClassName: string;
  errors?: { country?: string; county?: string; subCounty?: string };
  errorIdPrefix?: string;
  /** Wraps the County + Sub-county pair; defaults to a two-up flex row. */
  rowClassName?: string;
}

const SUB_COUNTIES_BY_COUNTY = new Map(Object.entries(KENYA_SUB_COUNTIES_BY_COUNTY));

/**
 * Country / County / Sub-county trio for Organization and Branch address
 * forms. Country is always a dropdown of the 54 African countries. For
 * Kenya, County and Sub-county cascade from the static geography.ts lists
 * (sub-county resets whenever county changes to a county it doesn't belong
 * to); for any other country we don't hold county/sub-county reference data,
 * so those two fall back to free-text input.
 */
export function LocationFields({
  country,
  county,
  subCounty,
  onCountryChange,
  onCountyChange,
  onSubCountyChange,
  labelClassName,
  fieldClassName,
  errors,
  errorIdPrefix = "location",
  rowClassName = "flex flex-wrap gap-4",
}: LocationFieldsProps) {
  const isKenya = country === "Kenya";
  const subCountyOptions = isKenya ? (SUB_COUNTIES_BY_COUNTY.get(county) ?? []) : [];
  const fieldClass = (error?: string) =>
    error ? `${fieldClassName} border-status-red focus:border-status-red` : fieldClassName;
  const fieldError = (field: string, message?: string) =>
    message ? (
      <span id={`${errorIdPrefix}-${field}-error`} className="text-xs font-medium text-status-red">
        {message}
      </span>
    ) : null;

  const handleCountyChange = (value: string) => {
    onCountyChange(value);
    if (isKenya && !(SUB_COUNTIES_BY_COUNTY.get(value) ?? []).includes(subCounty)) {
      onSubCountyChange("");
    }
  };

  return (
    <>
      <label className={labelClassName}>
        Country
        <select
          className={fieldClass(errors?.country)}
          aria-invalid={Boolean(errors?.country)}
          aria-describedby={errors?.country ? `${errorIdPrefix}-country-error` : undefined}
          value={country}
          onChange={(e) => {
            onCountryChange(e.target.value);
            if (e.target.value !== "Kenya") {
              onCountyChange("");
              onSubCountyChange("");
            }
          }}
        >
          {AFRICAN_COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {fieldError("country", errors?.country)}
      </label>
      <div className={rowClassName}>
        <label className={`${labelClassName} flex-1`}>
          County
          {isKenya ? (
            <select
              className={fieldClass(errors?.county)}
              aria-invalid={Boolean(errors?.county)}
              aria-describedby={errors?.county ? `${errorIdPrefix}-county-error` : undefined}
              value={county}
              onChange={(e) => handleCountyChange(e.target.value)}
            >
              <option value="">Select…</option>
              {KENYA_COUNTIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={fieldClass(errors?.county)}
              aria-invalid={Boolean(errors?.county)}
              aria-describedby={errors?.county ? `${errorIdPrefix}-county-error` : undefined}
              value={county}
              onChange={(e) => onCountyChange(e.target.value)}
            />
          )}
          {fieldError("county", errors?.county)}
        </label>
        <label className={`${labelClassName} flex-1`}>
          Sub-county
          {isKenya ? (
            <select
              className={fieldClass(errors?.subCounty)}
              aria-invalid={Boolean(errors?.subCounty)}
              aria-describedby={errors?.subCounty ? `${errorIdPrefix}-subCounty-error` : undefined}
              value={county ? subCounty : ""}
              disabled={!county}
              onChange={(e) => onSubCountyChange(e.target.value)}
            >
              <option value="">{county ? "Select…" : "Select a county first"}</option>
              {subCountyOptions.map((sc) => (
                <option key={sc} value={sc}>
                  {sc}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={fieldClass(errors?.subCounty)}
              aria-invalid={Boolean(errors?.subCounty)}
              aria-describedby={errors?.subCounty ? `${errorIdPrefix}-subCounty-error` : undefined}
              value={subCounty}
              onChange={(e) => onSubCountyChange(e.target.value)}
            />
          )}
          {fieldError("subCounty", errors?.subCounty)}
        </label>
      </div>
    </>
  );
}
