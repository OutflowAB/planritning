/** Case- and accent-insensitive form of a text, so "goteborg" finds "Göteborg". */
export function searchable(text: string) {
  return text.toLocaleLowerCase("sv-SE").normalize("NFD").replace(/[̀-ͯ]/g, "");
}
