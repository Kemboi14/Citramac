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
  /** Wraps the County + Sub-county pair; defaults to a two-up flex row. */
  rowClassName?: string;
}

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
  rowClassName = "flex flex-wrap gap-4",
}: LocationFieldsProps) {
  const isKenya = country === "Kenya";
  const subCountyOptions = isKenya ? KENYA_SUB_COUNTIES_BY_COUNTY[county] ?? [] : [];

  const handleCountyChange = (value: string) => {
    onCountyChange(value);
    if (isKenya && !(KENYA_SUB_COUNTIES_BY_COUNTY[value] ?? []).includes(subCounty)) {
      onSubCountyChange("");
    }
  };

  return (
    <>
      <label className={labelClassName}>
        Country
        <select
          className={fieldClassName}
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
      </label>
      <div className={rowClassName}>
        <label className={`${labelClassName} flex-1`}>
          County
          {isKenya ? (
            <select className={fieldClassName} value={county} onChange={(e) => handleCountyChange(e.target.value)}>
              <option value="">Select…</option>
              {KENYA_COUNTIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={fieldClassName}
              value={county}
              onChange={(e) => onCountyChange(e.target.value)}
            />
          )}
        </label>
        <label className={`${labelClassName} flex-1`}>
          Sub-county
          {isKenya ? (
            <select
              className={fieldClassName}
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
              className={fieldClassName}
              value={subCounty}
              onChange={(e) => onSubCountyChange(e.target.value)}
            />
          )}
        </label>
      </div>
    </>
  );
}
