import { createDefaultRegistry } from '../../../src/formats/index';
import { AndroidXmlFormatParser } from '../../../src/formats/android-xml';
import type { TranslatedEntry } from '../../../src/formats/format';

const parser = new AndroidXmlFormatParser();

describe('android-xml parser', () => {
  it('should be registered in the default registry', async () => {
    const registry = await createDefaultRegistry();
    const extensions = registry.getSupportedExtensions();
    expect(extensions.length).toBeGreaterThan(0);
  });

  describe('backslash escaping round-trip', () => {
    it('should round-trip a string containing a literal backslash', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="path">C:\\\\Users\\\\test</string>
</resources>`;
      const entries = parser.extract(xml);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.value).toBe('C:\\Users\\test');

      const translated: TranslatedEntry[] = [
        { key: 'path', value: 'C:\\Users\\test', translation: 'C:\\Users\\test' },
      ];
      const result = parser.reconstruct(xml, translated);
      expect(result).toContain('C:\\\\Users\\\\test');
    });

    it('should unescape backslash as last step to avoid double-processing', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="esc">line1\\nline2</string>
</resources>`;
      const entries = parser.extract(xml);
      expect(entries[0]!.value).toBe('line1\nline2');
    });

    it('should treat \\\\n as backslash + n, not as a newline', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="bs_n">prefix\\\\nsuffix</string>
</resources>`;
      const entries = parser.extract(xml);
      expect(entries[0]!.value).toBe('prefix\\nsuffix');
      expect(entries[0]!.value).toHaveLength(14);
    });

    it('should treat \\\\\\\\ as a single backslash', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="bs">one\\\\two</string>
</resources>`;
      const entries = parser.extract(xml);
      expect(entries[0]!.value).toBe('one\\two');
    });

    it('should handle escaped-backslash followed by escaped-apostrophe correctly', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="bsq">it\\\\\\'s</string>
</resources>`;
      const entries = parser.extract(xml);
      expect(entries[0]!.value).toBe("it\\'s");
    });

    it('should escape backslash as first step to avoid double-escaping', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="msg">Hello</string>
</resources>`;
      const translated: TranslatedEntry[] = [
        { key: 'msg', value: 'Hello', translation: 'back\\slash' },
      ];
      const result = parser.reconstruct(xml, translated);
      expect(result).toContain('back\\\\slash');
    });
  });

  describe('preserve extra attributes on plurals and string-array', () => {
    it('should preserve tools:ignore and other attributes on plurals', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <plurals name="items" tools:ignore="MissingQuantity">
        <item quantity="one">%d item</item>
        <item quantity="other">%d items</item>
    </plurals>
</resources>`;
      const entries = parser.extract(xml);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe('items');

      const translated: TranslatedEntry[] = [
        {
          key: 'items',
          value: '%d items',
          translation: '%d Elemente',
          metadata: {
            plurals: [
              { quantity: 'one', value: '%d Element' },
              { quantity: 'other', value: '%d Elemente' },
            ],
          },
        },
      ];
      const result = parser.reconstruct(xml, translated);
      expect(result).toContain('tools:ignore="MissingQuantity"');
    });

    it('should preserve extra attributes on string-array', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string-array name="colors" tools:ignore="ExtraTranslation">
        <item>Red</item>
        <item>Blue</item>
    </string-array>
</resources>`;
      const entries = parser.extract(xml);
      expect(entries).toHaveLength(2);

      const translated: TranslatedEntry[] = [
        { key: 'colors.0', value: 'Red', translation: 'Rot' },
        { key: 'colors.1', value: 'Blue', translation: 'Blau' },
      ];
      const result = parser.reconstruct(xml, translated);
      expect(result).toContain('tools:ignore="ExtraTranslation"');
    });
  });

  describe('CDATA handling for plurals and string-array items', () => {
    it('should extract CDATA values from plural items without literal markup', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <plurals name="items">
        <item quantity="one"><![CDATA[1 < item]]></item>
        <item quantity="other"><![CDATA[%d < items]]></item>
    </plurals>
</resources>`;

      const entries = parser.extract(xml);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.value).toBe('%d < items');
      expect(entries[0]!.metadata).toEqual({
        plurals: [
          { quantity: 'one', value: '1 < item' },
          { quantity: 'other', value: '%d < items' },
        ],
      });
    });

    it('should preserve CDATA wrappers when reconstructing plural items', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <plurals name="items">
        <item quantity="one"><![CDATA[1 < item]]></item>
        <item quantity="other"><![CDATA[%d < items]]></item>
    </plurals>
</resources>`;

      const translated: TranslatedEntry[] = [
        {
          key: 'items',
          value: '%d < items',
          translation: '%d < Elemente',
          metadata: {
            plurals: [
              { quantity: 'one', value: '1 < Element' },
              { quantity: 'other', value: '%d < Elemente' },
            ],
          },
        },
      ];

      const result = parser.reconstruct(xml, translated);
      expect(result).toContain('<item quantity="one"><![CDATA[1 < Element]]></item>');
      expect(result).toContain('<item quantity="other"><![CDATA[%d < Elemente]]></item>');
    });

    it('should preserve CDATA wrappers for string-array items during extract and reconstruct', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string-array name="labels">
        <item><![CDATA[Less < More]]></item>
        <item><![CDATA[Rock & Roll]]></item>
    </string-array>
</resources>`;

      const entries = parser.extract(xml);
      expect(entries).toEqual([
        { key: 'labels.0', value: 'Less < More' },
        { key: 'labels.1', value: 'Rock & Roll' },
      ]);

      const translated: TranslatedEntry[] = [
        { key: 'labels.0', value: 'Less < More', translation: 'Weniger < Mehr' },
        { key: 'labels.1', value: 'Rock & Roll', translation: 'Rock & Roll DE' },
      ];

      const result = parser.reconstruct(xml, translated);
      expect(result).toContain('<item><![CDATA[Weniger < Mehr]]></item>');
      expect(result).toContain('<item><![CDATA[Rock & Roll DE]]></item>');
    });
  });

  describe('remove deleted keys from reconstructed output', () => {
    it('should remove string elements not present in entries', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="greeting">Hello</string>
    <string name="farewell">Goodbye</string>
    <string name="thanks">Thank you</string>
</resources>`;
      const translated: TranslatedEntry[] = [
        { key: 'greeting', value: 'Hello', translation: 'Hallo' },
        { key: 'thanks', value: 'Thank you', translation: 'Danke' },
      ];
      const result = parser.reconstruct(xml, translated);
      expect(result).toContain('name="greeting"');
      expect(result).toContain('name="thanks"');
      expect(result).not.toContain('name="farewell"');
      expect(result).not.toContain('Goodbye');
    });

    it('should remove plural elements not present in entries', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <plurals name="items">
        <item quantity="one">%d item</item>
        <item quantity="other">%d items</item>
    </plurals>
    <plurals name="days">
        <item quantity="one">%d day</item>
        <item quantity="other">%d days</item>
    </plurals>
</resources>`;
      const translated: TranslatedEntry[] = [
        {
          key: 'items',
          value: '%d items',
          translation: '%d Elemente',
          metadata: {
            plurals: [
              { quantity: 'one', value: '%d Element' },
              { quantity: 'other', value: '%d Elemente' },
            ],
          },
        },
      ];
      const result = parser.reconstruct(xml, translated);
      expect(result).toContain('name="items"');
      expect(result).not.toContain('name="days"');
    });

    it('should remove string-array elements not present in entries', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string-array name="colors">
        <item>Red</item>
        <item>Blue</item>
    </string-array>
    <string-array name="sizes">
        <item>Small</item>
        <item>Large</item>
    </string-array>
</resources>`;
      const translated: TranslatedEntry[] = [
        { key: 'colors.0', value: 'Red', translation: 'Rot' },
        { key: 'colors.1', value: 'Blue', translation: 'Blau' },
      ];
      const result = parser.reconstruct(xml, translated);
      expect(result).toContain('name="colors"');
      expect(result).not.toContain('name="sizes"');
    });

    it('should keep a self-closing string element untouched', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="empty"/>
    <string name="greeting">Hello</string>
</resources>`;
      const entries = parser.extract(xml);
      expect(entries.map((e) => e.key)).toEqual(['greeting']);

      const result = parser.reconstruct(xml, [
        { key: 'greeting', value: 'Hello', translation: 'Hallo' },
      ]);
      expect(result).toContain('<string name="empty"/>');
      expect(result).toContain('<string name="greeting">Hallo</string>');
    });

    it('should preserve translatable="false" strings even when not in entries', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name" translatable="false">MyApp</string>
    <string name="greeting">Hello</string>
</resources>`;
      const translated: TranslatedEntry[] = [
        { key: 'greeting', value: 'Hello', translation: 'Hallo' },
      ];
      const result = parser.reconstruct(xml, translated);
      expect(result).toContain('name="app_name"');
      expect(result).toContain('name="greeting"');
    });
  });

  describe('elements with no closing tag', () => {
    const unclosed = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="greeting">Hello</string>
    <string name="dangling">Never closed
</resources>`;

    it('should still extract the well-formed entries before the dangling tag', () => {
      expect(parser.extract(unclosed).map((e) => e.key)).toEqual(['greeting']);
    });

    it('should leave the dangling element untouched on reconstruct', () => {
      const result = parser.reconstruct(unclosed, [
        { key: 'greeting', value: 'Hello', translation: 'Hallo' },
      ]);
      expect(result).toContain('<string name="greeting">Hallo</string>');
      expect(result).toContain('<string name="dangling">Never closed');
    });

    it('should not let a CDATA body swallow the closing tag', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="snippet"><![CDATA[use <string name="x">y</string> here]]></string>
    <string name="plain">Plain</string>
</resources>`;
      expect(parser.extract(xml)).toEqual([
        { key: 'snippet', value: 'use <string name="x">y</string> here' },
        { key: 'plain', value: 'Plain' },
      ]);
    });
  });

  describe('adversarial input scaling', () => {
    // A file of opening tags that never close: the parser must not rescan the
    // remainder of the input once per opening tag.
    function unclosedOpeners(bytes: number): string {
      const head = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n';
      const opener =
        '    <string name="k">v\n    <plurals name="p">\n    <string-array name="a">\n';
      return head + opener.repeat(Math.ceil((bytes - head.length) / opener.length));
    }

    const content = unclosedOpeners(4 * 1024 * 1024);

    it('should extract a 4 MiB file of unclosed openers in linear time', () => {
      const start = process.hrtime.bigint();
      parser.extract(content);
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      expect(ms).toBeLessThan(2000);
    });

    it('should reconstruct a 4 MiB file of unclosed openers in linear time', () => {
      const start = process.hrtime.bigint();
      parser.reconstruct(content, [{ key: 'k', value: 'v', translation: 'w' }]);
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      expect(ms).toBeLessThan(2000);
    });
  });
});
