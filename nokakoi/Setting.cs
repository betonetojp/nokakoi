using System.Diagnostics;
using System.Text;
using System.Xml;
using System.Xml.Serialization;

namespace nokakoi
{
    public class Setting
    {
        private static Data _data = new();

        #region データクラス
        public class Data
        {
            public Point Location { get; set; }
            public Size Size { get; set; } = new Size(320, 320);
            public string Relay { get; set; } = "wss://yabu.me";
            public bool TopMost { get; set; } = false;
            public int CutLength { get; set; } = 40;
            public int CutNameLength { get; set; } = 8;
            public double Opacity { get; set; } = 1.00;
            public bool DisplayTime { get; set; } = true;
            public bool AddShortcode { get; set; } = true;
            public string Shortcode { get; set; } = "n";
            public string EmojiUrl { get; set; } = "https://betoneto.win/media/nokakoi.png";
            public bool AddClient { get; set; } = true;
            public bool ShowOnlyTagged { get; set; } = false;
            public bool ShowOnlyJapanese { get; set; } = false;
            public bool ShowOnlyFollowees { get; set; } = false;
            public string NokakoiKey { get; set; } = string.Empty;
            public Point PostBarLocation { get; set; }
            public Size PostBarSize { get; set; }
        }
        #endregion

        #region プロパティ
        public static Point Location
        {
            get
            {
                return _data.Location;
            }
            set
            {
                _data.Location = value;
            }
        }
        public static Size Size
        {
            get
            {
                return _data.Size;
            }
            set
            {
                _data.Size = value;
            }
        }
        public static string Relay
        {
            get
            {
                return _data.Relay;
            }
            set
            {
                _data.Relay = value;
            }
        }
        public static bool TopMost
        {
            get
            {
                return _data.TopMost;
            }
            set
            {
                _data.TopMost = value;
            }
        }
        public static int CutLength
        {
            get
            {
                return _data.CutLength;
            }
            set
            {
                _data.CutLength = value;
            }
        }
        public static int CutNameLength
        {
            get
            {
                return _data.CutNameLength;
            }
            set
            {
                _data.CutNameLength = value;
            }
        }
        public static double Opacity
        {
            get
            {
                return _data.Opacity;
            }
            set
            {
                _data.Opacity = value;
            }
        }
        public static bool DisplayTime
        {
            get
            {
                return _data.DisplayTime;
            }
            set
            {
                _data.DisplayTime = value;
            }
        }
        public static bool AddShortcode
        {
            get
            {
                return _data.AddShortcode;
            }
            set
            {
                _data.AddShortcode = value;
            }
        }
        public static string Shortcode
        {
            get
            {
                return _data.Shortcode;
            }
            set
            {
                _data.Shortcode = value;
            }
        }
        public static string EmojiUrl
        {
            get
            {
                return _data.EmojiUrl;
            }
            set
            {
                _data.EmojiUrl = value;
            }
        }
        public static bool AddClient
        {
            get
            {
                return _data.AddClient;
            }
            set
            {
                _data.AddClient = value;
            }
        }
        public static bool ShowOnlyTagged
        {
            get
            {
                return _data.ShowOnlyTagged;
            }
            set
            {
                _data.ShowOnlyTagged = value;
            }
        }
        public static bool ShowOnlyJapanese
        {
            get
            {
                return _data.ShowOnlyJapanese;
            }
            set
            {
                _data.ShowOnlyJapanese = value;
            }
        }
        public static bool ShowOnlyFollowees
        {
            get
            {
                return _data.ShowOnlyFollowees;
            }
            set
            {
                _data.ShowOnlyFollowees = value;
            }
        }
        public static string NokakoiKey
        {
            get
            {
                return _data.NokakoiKey;
            }
            set
            {
                _data.NokakoiKey = value;
            }
        }
        public static Point PostBarLocation
        {
            get
            {
                return _data.PostBarLocation;
            }
            set
            {
                _data.PostBarLocation = value;
            }
        }
        public static Size PostBarSize
        {
            get
            {
                return _data.PostBarSize;
            }
            set
            {
                _data.PostBarSize = value;
            }
        }
        #endregion

        #region 設定ファイル操作
        /// <summary>
        /// 設定ファイル読み込み
        /// </summary>
        /// <param name="path"></param>
        /// <returns></returns>
        public static bool Load(string path)
        {
            try
            {
                var serializer = new XmlSerializer(typeof(Data));
                var xmlSettings = new XmlReaderSettings();
                using var streamReader = new StreamReader(path, Encoding.UTF8);
                using var xmlReader = XmlReader.Create(streamReader, xmlSettings);
                _data = serializer.Deserialize(xmlReader) as Data ?? _data;
                return true;
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex.Message);
                return false;
            }
        }

        /// <summary>
        /// 設定ファイル書き込み
        /// </summary>
        /// <param name="path"></param>
        /// <returns></returns>
        public static bool Save(string path)
        {
            try
            {
                var serializer = new XmlSerializer(typeof(Data));
                using var streamWriter = new StreamWriter(path, false, Encoding.UTF8);
                serializer.Serialize(streamWriter, _data);
                streamWriter.Flush();
                return true;
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex.Message);
                return false;
            }
        }
        #endregion
    }
}
