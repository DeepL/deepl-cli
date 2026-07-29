import { parseIcu } from '../../../src/utils/icu-preservation';

describe('icu-preservation', () => {
  describe('parseIcu', () => {
    describe('detection', () => {
      it('should detect plural pattern', () => {
        const result = parseIcu('{count, plural, one {# item} other {# items}}');
        expect(result.isIcu).toBe(true);
      });

      it('should detect select pattern', () => {
        const result = parseIcu('{gender, select, male {He} female {She} other {They}}');
        expect(result.isIcu).toBe(true);
      });

      it('should detect selectordinal pattern', () => {
        const result = parseIcu('{count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}');
        expect(result.isIcu).toBe(true);
      });

      it('should NOT detect simple variables', () => {
        const result = parseIcu('{count}');
        expect(result.isIcu).toBe(false);
      });

      it('should NOT detect plain text', () => {
        const result = parseIcu('Hello world');
        expect(result.isIcu).toBe(false);
      });

      it('should NOT detect double-brace variables', () => {
        const result = parseIcu('{{count}}');
        expect(result.isIcu).toBe(false);
      });

      it('should NOT detect unknown keywords', () => {
        const result = parseIcu('{count, unknown, one {x} other {y}}');
        expect(result.isIcu).toBe(false);
      });
    });

    describe('plural extraction', () => {
      it('should extract leaf text from plural branches', () => {
        const result = parseIcu('{count, plural, one {# item} other {# items}}');
        expect(result.isIcu).toBe(true);
        expect(result.segments).toHaveLength(2);
        expect(result.segments[0]!.text).toBe('# item');
        expect(result.segments[1]!.text).toBe('# items');
      });

      it('should mark segments as plural branches', () => {
        const result = parseIcu('{count, plural, one {# item} other {# items}}');
        expect(result.segments[0]!.isPluralBranch).toBe(true);
        expect(result.segments[1]!.isPluralBranch).toBe(true);
      });

      it('should handle =0 selector', () => {
        const result = parseIcu('{count, plural, =0 {No items} one {# item} other {# items}}');
        expect(result.segments).toHaveLength(3);
        expect(result.segments[0]!.text).toBe('No items');
        expect(result.segments[1]!.text).toBe('# item');
        expect(result.segments[2]!.text).toBe('# items');
      });

      it('should handle many plural categories', () => {
        const result = parseIcu('{count, plural, zero {none} one {single} two {pair} few {several} many {lots} other {some}}');
        expect(result.segments).toHaveLength(6);
      });
    });

    describe('select extraction', () => {
      it('should extract leaf text from select branches', () => {
        const result = parseIcu('{gender, select, male {He liked your post} female {She liked your post} other {They liked your post}}');
        expect(result.isIcu).toBe(true);
        expect(result.segments).toHaveLength(3);
        expect(result.segments[0]!.text).toBe('He liked your post');
        expect(result.segments[1]!.text).toBe('She liked your post');
        expect(result.segments[2]!.text).toBe('They liked your post');
      });

      it('should NOT mark select segments as plural branches', () => {
        const result = parseIcu('{gender, select, male {He} other {They}}');
        expect(result.segments[0]!.isPluralBranch).toBe(false);
        expect(result.segments[1]!.isPluralBranch).toBe(false);
      });
    });

    describe('selectordinal extraction', () => {
      it('should extract ordinal branches', () => {
        const result = parseIcu('{count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}');
        expect(result.segments).toHaveLength(4);
        expect(result.segments[0]!.text).toBe('#st');
        expect(result.segments[3]!.text).toBe('#th');
        expect(result.segments[0]!.isPluralBranch).toBe(true);
      });
    });

    describe('reassembly', () => {
      it('should reassemble plural with translated text', () => {
        const result = parseIcu('{count, plural, one {# item} other {# items}}');
        const translated = result.reassemble(['# Artikel', '# Artikel']);
        expect(translated).toBe('{count, plural, one {# Artikel} other {# Artikel}}');
      });

      it('should reassemble select with translated text', () => {
        const result = parseIcu('{gender, select, male {He} female {She} other {They}}');
        const translated = result.reassemble(['Er', 'Sie', 'Sie']);
        expect(translated).toBe('{gender, select, male {Er} female {Sie} other {Sie}}');
      });

      it('should preserve variable name and keyword exactly', () => {
        const result = parseIcu('{myCount, plural, one {one thing} other {many things}}');
        const translated = result.reassemble(['eine Sache', 'viele Sachen']);
        expect(translated).toContain('myCount');
        expect(translated).toContain('plural');
        expect(translated).toContain('one {');
        expect(translated).toContain('other {');
      });

      it('should preserve =0 selector', () => {
        const result = parseIcu('{n, plural, =0 {nothing} other {something}}');
        const translated = result.reassemble(['nichts', 'etwas']);
        expect(translated).toBe('{n, plural, =0 {nichts} other {etwas}}');
      });
    });

    describe('offset', () => {
      it('should parse plural with offset:1', () => {
        const result = parseIcu('{count, plural, offset:1 one {you and # other} other {you and # others}}');
        expect(result.isIcu).toBe(true);
        expect(result.segments).toHaveLength(2);
        expect(result.segments[0]!.text).toBe('you and # other');
        expect(result.segments[1]!.text).toBe('you and # others');
      });

      it('should preserve offset:1 verbatim on reassembly', () => {
        const input = '{count, plural, offset:1 one {you and # other} other {you and # others}}';
        const result = parseIcu(input);
        const roundTrip = result.reassemble(result.segments.map((s) => s.text));
        expect(roundTrip).toBe(input);
      });

      it('should parse offset:0', () => {
        const result = parseIcu('{count, plural, offset:0 one {# item} other {# items}}');
        expect(result.isIcu).toBe(true);
        expect(result.reassemble(['# item', '# items'])).toBe(
          '{count, plural, offset:0 one {# item} other {# items}}',
        );
      });

      it('should parse selectordinal with offset', () => {
        const result = parseIcu('{count, selectordinal, offset:2 one {#st} other {#th}}');
        expect(result.isIcu).toBe(true);
        expect(result.segments).toHaveLength(2);
        expect(result.reassemble(['#st', '#th'])).toBe(
          '{count, selectordinal, offset:2 one {#st} other {#th}}',
        );
      });

      it('should parse nested plural with offset', () => {
        const input = '{count, plural, offset:1 one {{gender, select, male {He} other {They}}} other {# guests}}';
        const result = parseIcu(input);
        expect(result.isIcu).toBe(true);
        expect(result.segments).toHaveLength(3);
        expect(result.reassemble(result.segments.map((s) => s.text))).toBe(input);
      });

      it('should NOT treat offset as valid for select', () => {
        const result = parseIcu('{gender, select, offset:1 male {He} other {They}}');
        expect(result.isIcu).toBe(false);
      });
    });

    describe('quoting', () => {
      it('should parse unbalanced quoted opening brace', () => {
        const result = parseIcu("{count, plural, other {Use '{' to open}}");
        expect(result.isIcu).toBe(true);
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0]!.text).toBe("Use '{' to open");
      });

      it('should parse unbalanced quoted closing brace', () => {
        const result = parseIcu("{count, plural, other {Use '}' to close}}");
        expect(result.isIcu).toBe(true);
        expect(result.segments[0]!.text).toBe("Use '}' to close");
      });

      it('should parse balanced quoted braces', () => {
        const result = parseIcu("{count, plural, other {'{'#'}' items}}");
        expect(result.isIcu).toBe(true);
        expect(result.segments[0]!.text).toBe("'{'#'}' items");
      });

      it('should round-trip quoted spans byte-exact', () => {
        const input = "{count, plural, other {Use '{' to open}}";
        const result = parseIcu(input);
        const roundTrip = result.reassemble(result.segments.map((s) => s.text));
        expect(roundTrip).toBe(input);
      });

      it('should keep a plain apostrophe before a non-syntax char literal', () => {
        const result = parseIcu("{count, plural, other {50'%' off}}");
        expect(result.isIcu).toBe(true);
        expect(result.segments[0]!.text).toBe("50'%' off");
      });

      it('should treat a doubled apostrophe as a literal apostrophe', () => {
        const result = parseIcu("{count, plural, other {It''s here}}");
        expect(result.isIcu).toBe(true);
        expect(result.segments[0]!.text).toBe("It''s here");
      });

      it('should handle a doubled apostrophe at the end of branch content', () => {
        const result = parseIcu("{count, plural, other {kids''}}");
        expect(result.isIcu).toBe(true);
        expect(result.segments[0]!.text).toBe("kids''");
      });

      it('should handle a plain apostrophe mid-word', () => {
        const result = parseIcu("{count, plural, other {five o'clock}}");
        expect(result.isIcu).toBe(true);
        expect(result.segments[0]!.text).toBe("five o'clock");
      });

      it('should quote # in plural context', () => {
        const result = parseIcu("{count, plural, other {'#{' open}}");
        expect(result.isIcu).toBe(true);
        expect(result.segments[0]!.text).toBe("'#{' open");
      });

      it('should NOT quote # in select context', () => {
        const result = parseIcu("{gender, select, other {'#{' open}}");
        expect(result.isIcu).toBe(false);
      });

      it('should fall back when a quoted brace is left unterminated at end of string', () => {
        const result = parseIcu("{count, plural, other {items'}}");
        expect(result.isIcu).toBe(false);
      });
    });

    describe('non-ICU passthrough', () => {
      it('should return identity reassemble for non-ICU text', () => {
        const result = parseIcu('Hello {name}');
        expect(result.isIcu).toBe(false);
        expect(result.reassemble([])).toBe('Hello {name}');
      });

      it('should return identity for empty string', () => {
        const result = parseIcu('');
        expect(result.isIcu).toBe(false);
        expect(result.reassemble([])).toBe('');
      });
    });

    describe('edge cases', () => {
      it('should handle whitespace variations', () => {
        const result = parseIcu('{ count , plural , one { # item } other { # items } }');
        expect(result.isIcu).toBe(true);
        expect(result.segments).toHaveLength(2);
        expect(result.segments[0]!.text).toBe(' # item ');
        expect(result.segments[1]!.text).toBe(' # items ');
      });

      it('should handle empty branch content', () => {
        const result = parseIcu('{count, plural, one {} other {items}}');
        expect(result.isIcu).toBe(true);
        expect(result.segments[0]!.text).toBe('');
        expect(result.segments[1]!.text).toBe('items');
      });

      it('should handle branches with simple variables inside', () => {
        const result = parseIcu('{count, plural, one {{name} has # item} other {{name} has # items}}');
        expect(result.isIcu).toBe(true);
        expect(result.segments).toHaveLength(2);
        expect(result.segments[0]!.text).toContain('{name}');
        expect(result.segments[0]!.text).toContain('# item');
      });

      it('should fall back safely on malformed input', () => {
        const result = parseIcu('{count, plural, one {unclosed');
        expect(result.isIcu).toBe(false);
        expect(result.reassemble([])).toBe('{count, plural, one {unclosed');
      });

      it('should fall back on missing closing brace', () => {
        const result = parseIcu('{count, plural, one {item} other {items}');
        expect(result.isIcu).toBe(false);
      });

      it('should handle nested ICU (select inside plural)', () => {
        const input = '{count, plural, one {{gender, select, male {He has # item} female {She has # item} other {They have # item}}} other {{gender, select, male {He has # items} female {She has # items} other {They have # items}}}}';
        const result = parseIcu(input);
        expect(result.isIcu).toBe(true);
        // Nested: 2 plural branches × 3 select branches = 6 leaf segments
        expect(result.segments).toHaveLength(6);
      });

      it('should handle long branch text', () => {
        const longText = 'A'.repeat(500);
        const result = parseIcu(`{n, plural, one {${longText}} other {${longText}s}}`);
        expect(result.isIcu).toBe(true);
        expect(result.segments[0]!.text).toBe(longText);
      });
    });
  });
});
