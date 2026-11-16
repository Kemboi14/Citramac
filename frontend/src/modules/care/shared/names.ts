/** Capital first letter of each word in a name, as it is typed. Only the first
 * letter changes (so "McDonald" stays as typed), and only after a space or a
 * hyphen, never after an apostrophe ("Ng'ang'a", not "Ng'Ang'A"). */
export function capitalizeName(value: string) {
  return value.replace(
    /(^|[\s-])(\p{Ll})/gu,
    (_, before: string, letter: string) => before + letter.toLocaleUpperCase(),
  );
}
