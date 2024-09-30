using System.Text;
using System.Text.Encodings.Web;

namespace NNostr.Client
{
    /// <summary>
    /// 絵文字をエスケープしないようにするエンコーダー
    /// </summary>
    public class NoEscapingJsonEncoder : JavaScriptEncoder
    {
        public static JavaScriptEncoder NoEscaping { get; } = new NoEscapingJsonEncoder();

        public override int MaxOutputCharactersPerInputCharacter => 12;

        private static readonly HashSet<char> _escapingBmpChar = new() { '\b', '\t', '\n', '\f', '\r', '\"', '\\' };

        public override unsafe int FindFirstCharacterToEncode(char* text, int textLength)
        {
            for (int i = 0; i < textLength; i++)
            {
                if (WillEncode(text[i])) return i;
            }
            return -1;
        }

        public override unsafe bool TryEncodeUnicodeScalar(int unicodeScalar, char* buffer, int bufferLength, out int numberOfCharactersWritten)
        {
            static void escape(char c, char* buffer)
            {
                buffer[0] = '\\';
                buffer[1] = 'u';
                ((ushort)c).TryFormat(new Span<char>(buffer + 2, 4), out _, "X4");
            }

            char? escapeChar = unicodeScalar switch
            {
                '\b' => 'b',
                '\t' => 't',
                '\n' => 'n',
                '\f' => 'f',
                '\r' => 'r',
                '\"' => '\"',
                '\\' => '\\',
                _ => null,
            };

            if (escapeChar is { } notNull)
            {
                if (bufferLength < 2)
                {
                    numberOfCharactersWritten = 0;
                    return false;
                }

                buffer[0] = '\\';
                buffer[1] = notNull;
                numberOfCharactersWritten = 2;
            }
            else if (char.IsControl((char)unicodeScalar))
            {
                escape((char)unicodeScalar, buffer);
                numberOfCharactersWritten = 6;
            }
            else if (unicodeScalar > 0xFFFF)
            {
                if (bufferLength < 6)
                {
                    numberOfCharactersWritten = 0;
                    return false;
                }

                var r = new Rune(unicodeScalar);
                Span<char> utf16 = stackalloc char[2];
                var len = r.EncodeToUtf16(utf16);

                escape(utf16[0], buffer);
                numberOfCharactersWritten = 6;

                if (len > 1)
                {
                    if (bufferLength < 12)
                    {
                        numberOfCharactersWritten = 0;
                        return false;
                    }

                    escape(utf16[1], buffer + 6);
                    numberOfCharactersWritten = 12;
                }
            }
            else
            {
                buffer[0] = (char)unicodeScalar;
                numberOfCharactersWritten = 1;
            }

            return true;
        }

        public override bool WillEncode(int unicodeScalar)
        {
            return char.IsControl((char)unicodeScalar) || unicodeScalar > 0xFFFF || _escapingBmpChar.Contains((char)unicodeScalar);
        }
    }
}