// Spellings of the column headings an import file may use, squashed (lower case, letters and digits only), in all interface languages.
export type ImportColumn = 'type' | 'apartment' | 'normType' | 'category' | 'item' | 'qty' | 'unit' | 'note'

export const HEADER_WORDS: Record<ImportColumn, string[]> = {
  type: ['тип', 'типквартиры', 'type', 'apttype', 'apartmenttype', 'النوع', 'نوعالشقة'],
  apartment: ['квартира', 'номерквартиры', 'кодквартиры', 'apartment', 'apartmentcode', 'apt', 'flat', 'code', 'الشقة', 'رقمالشقة'],
  normType: ['виднормы', 'видномы', 'норма', 'вид', 'normtype', 'norm', 'نوعالمعيار', 'المعيار'],
  category: ['категория', 'category', 'الفئة'],
  item: ['предмет', 'товар', 'позиция', 'наименование', 'item', 'name', 'product', 'البند', 'الصنف'],
  qty: ['количество', 'колво', 'кол', 'qty', 'quantity', 'amount', 'الكمية'],
  unit: ['ед', 'единица', 'едизм', 'unit', 'الوحدة'],
  note: ['примечание', 'заметка', 'комментарий', 'note', 'comment', 'ملاحظة'],
}
