using System.Security.Cryptography;
using System.Text;

namespace nokakoi
{
    public static class NokakoiCrypt
    {
        public static readonly string NokakoiTag = "nokakoi:";

        // ソルトがnullだとArgumentNullExceptionが発生
        // 安全のため消してあるので適宜設定してください↓
        private static readonly string _nokakoiSalt;

        /// <summary>
        /// nokakoiキーを生成する
        /// </summary>
        /// <param name="nsec">Nostrプライベートキー</param>
        /// <param name="password">パスワード</param>
        /// <returns>nokakoiキー</returns>
        public static string EncryptNokakoiKey(string nsec, string password)
        {
            var aes = Aes.Create();

            return NokakoiTag + aes.EncryptString(nsec, password);
        }

        /// <summary>
        /// Nostrプライベートキーを復号する
        /// </summary>
        /// <param name="nokakoiKey">nokakoiキー</param>
        /// <param name="password">パスワード</param>
        /// <returns></returns>
        public static string DecryptNokakoiKey(string nokakoiKey, string password)
        {
            var aes = Aes.Create();

            return aes.DecryptString(nokakoiKey.Replace(NokakoiTag, ""), password);
        }

        /// <summary>
        /// 文字列を暗号化する
        /// </summary>
        /// <param name="sourceString">暗号化する文字列</param>
        /// <param name="password">暗号化に使用するパスワード</param>
        /// <returns>暗号化された文字列</returns>
        static string EncryptString(this SymmetricAlgorithm algorithm, string sourceString, string password)
        {
            //パスワードから共有キーと初期化ベクタを作成
            byte[] key, iv;
            GenerateKeyFromPassword(password, algorithm.KeySize, out key, algorithm.BlockSize, out iv);
            algorithm.Key = key;
            algorithm.IV = iv;

            //文字列をバイト型配列に変換する
            byte[] strBytes = Encoding.UTF8.GetBytes(sourceString);

            //対称暗号化オブジェクトの作成
            ICryptoTransform encryptor = algorithm.CreateEncryptor();
            //バイト型配列を暗号化する
            byte[] encBytes = encryptor.TransformFinalBlock(strBytes, 0, strBytes.Length);
            //閉じる
            encryptor.Dispose();

            //バイト型配列を文字列に変換して返す
            return BitConverter.ToString(encBytes).Replace("-", string.Empty).ToLower();
        }

        /// <summary>
        /// 暗号化された文字列を復号化する
        /// </summary>
        /// <param name="sourceString">暗号化された文字列</param>
        /// <param name="password">暗号化に使用したパスワード</param>
        /// <returns>復号化された文字列</returns>
        static string DecryptString(this SymmetricAlgorithm algorithm, string sourceString, string password)
        {
            //パスワードから共有キーと初期化ベクタを作成
            byte[] key, iv;
            GenerateKeyFromPassword(password, algorithm.KeySize, out key, algorithm.BlockSize, out iv);
            algorithm.Key = key;
            algorithm.IV = iv;

            //文字列をバイト型配列に戻す
            //byte[] strBytes = Convert.FromBase64String(sourceString);
            byte[] strBytes = StringToBytes(sourceString);

            //対称暗号化オブジェクトの作成
            ICryptoTransform decryptor = algorithm.CreateDecryptor();
            //バイト型配列を復号化する
            //復号化に失敗すると例外CryptographicExceptionが発生
            byte[] decBytes = decryptor.TransformFinalBlock(strBytes, 0, strBytes.Length);
            //閉じる
            decryptor.Dispose();

            //バイト型配列を文字列に戻して返す
            return Encoding.UTF8.GetString(decBytes);
        }

        /// <summary>
        /// パスワードから共有キーと初期化ベクタを生成する
        /// </summary>
        /// <param name="password">基になるパスワード</param>
        /// <param name="keySize">共有キーのサイズ（ビット）</param>
        /// <param name="key">作成された共有キー</param>
        /// <param name="blockSize">初期化ベクタのサイズ（ビット）</param>
        /// <param name="iv">作成された初期化ベクタ</param>
        static void GenerateKeyFromPassword(string password, int keySize, out byte[] key, int blockSize, out byte[] iv)
        {
            //パスワードから共有キーと初期化ベクタを作成する
            //saltを決める
            byte[] salt = Encoding.UTF8.GetBytes(_nokakoiSalt);
            //Rfc2898DeriveBytesオブジェクトを作成する
            Rfc2898DeriveBytes deriveBytes = new(password, salt, 1000, HashAlgorithmName.SHA1);
            //共有キーと初期化ベクタを生成する
            key = deriveBytes.GetBytes(keySize / 8);
            iv = deriveBytes.GetBytes(blockSize / 8);
        }

        /// <summary>
        /// 16進数文字列をバイト型配列に変換する
        /// </summary>
        /// <param name="str">16進数文字列</param>
        /// <returns>バイト型配列</returns>
        static byte[] StringToBytes(string str)
        {
            var bs = new List<byte>();
            for (int i = 0; i < str.Length / 2; i++)
            {
                bs.Add(Convert.ToByte(str.Substring(i * 2, 2), 16));
            }
            
            return bs.ToArray();
        }
    }


}
