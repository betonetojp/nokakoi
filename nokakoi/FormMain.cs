using NNostr.Client;
using NNostr.Client.Protocols;
using NTextCat;
using NTextCat.Commons;
using SSTPLib;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Text.RegularExpressions;

namespace nokakoi
{
    public partial class FormMain : Form
    {
        #region メンバー変数
        private readonly TimeSpan _timeSpan = new(0, 0, 0, 0);
        private readonly FormSetting _formSetting = new();
        private readonly FormPostBar _formPostBar = new();
        private FormManiacs _formManiacs = new();

        private NostrClient? _client;
        /// <summary>
        /// タイムライン購読ID
        /// </summary>
        private readonly string _subscriptionId = Guid.NewGuid().ToString("N");
        /// <summary>
        /// フォロイー購読ID
        /// </summary>
        private readonly string _getFollowsSubscriptionId = Guid.NewGuid().ToString("N");
        /// <summary>
        /// プロフィール購読ID
        /// </summary>
        private readonly string _getProfilesSubscriptionId = Guid.NewGuid().ToString("N");

        private string _nsec = string.Empty;
        //private string _npub = string.Empty;
        private string _npubHex = string.Empty;

        /// <summary>
        /// フォロイー公開鍵のハッシュセット
        /// </summary>
        private readonly HashSet<string> _followeesHexs = [];
        /// <summary>
        /// ユーザー辞書
        /// </summary>
        internal Dictionary<string, User?> Users = [];
        /// <summary>
        /// キーワード通知
        /// </summary>
        internal KeywordNotifier Notifier = new();

        private int _cutLength;
        private int _cutNameLength;
        private bool _displayTime;
        private bool _addShortcode;
        private string _shortcode = string.Empty;
        private string _emojiUrl = string.Empty;
        private bool _addClient;
        private bool _showOnlyTagged;
        private bool _showOnlyJapanese;
        private bool _showOnlyFollowees;
        private string _nokakoiKey = string.Empty;
        private string _password = string.Empty;

        private double _tempOpacity = 1.00;

        private readonly DSSTPSender _ds = new("SakuraUnicode");
        private readonly string _SSTPMethod = "NOTIFY SSTP/1.1";
        private readonly Dictionary<string, string> _baseSSTPHeader = new(){
            {"Charset","UTF-8"},
            {"Sender","nokakoi"},
            {"Option","nobreak,notranslate"},
            {"Event","OnNostr"},
            {"Reference0","Nostr/0.2"}
        };

        private string _ghostName = string.Empty;
        #endregion

        #region コンストラクタ
        // コンストラクタ
        public FormMain()
        {
            InitializeComponent();

            // ボタンの画像をDPIに合わせて表示
            float scale = CreateGraphics().DpiX / 96f;
            int size = (int)(16 * scale);
            if (scale < 2.0f)
            {
                buttonStart.Image = new Bitmap(Properties.Resources.icons8_start_16, size, size);
                buttonStop.Image = new Bitmap(Properties.Resources.icons8_stop_16, size, size);
                buttonPost.Image = new Bitmap(Properties.Resources.icons8_create_16, size, size);
                buttonSetting.Image = new Bitmap(Properties.Resources.icons8_setting_16, size, size);
            }
            else
            {
                buttonStart.Image = new Bitmap(Properties.Resources.icons8_start_32, size, size);
                buttonStop.Image = new Bitmap(Properties.Resources.icons8_stop_32, size, size);
                buttonPost.Image = new Bitmap(Properties.Resources.icons8_create_32, size, size);
                buttonSetting.Image = new Bitmap(Properties.Resources.icons8_setting_32, size, size);
            }

            Setting.Load("nokakoi.config");
            Users = Tools.LoadUsers();

            Location = Setting.Location;
            if (new Point(0, 0) == Location)
            {
                StartPosition = FormStartPosition.CenterScreen;
            }
            Size = Setting.Size;
            textBoxRelay.Text = Setting.Relay;
            TopMost = Setting.TopMost;
            _cutLength = Setting.CutLength;
            _cutNameLength = Setting.CutNameLength;
            Opacity = Setting.Opacity;
            if (0 == Opacity)
            {
                Opacity = 1;
            }
            _formPostBar.Opacity = Opacity;
            _displayTime = Setting.DisplayTime;
            _addShortcode = Setting.AddShortcode;
            _shortcode = Setting.Shortcode;
            _emojiUrl = Setting.EmojiUrl;
            _addClient = Setting.AddClient;
            _showOnlyTagged = Setting.ShowOnlyTagged;
            _showOnlyJapanese = Setting.ShowOnlyJapanese;
            _showOnlyFollowees = Setting.ShowOnlyFollowees;
            _nokakoiKey = Setting.NokakoiKey;
            _formPostBar.Location = Setting.PostBarLocation;
            if (new Point(0, 0) == _formPostBar.Location)
            {
                _formPostBar.StartPosition = FormStartPosition.CenterScreen;
            }
            _formPostBar.Size = Setting.PostBarSize;

            _formSetting._formPostBar = _formPostBar;
            _formPostBar.MainForm = this;
            _formManiacs.MainForm = this;
        }
        #endregion

        #region Startボタン
        // Startボタン
        private async void ButtonStart_Click(object sender, EventArgs e)
        {
            try
            {
                await ConnectAsync();

                textBoxRelay.ForeColor = SystemColors.GrayText;
                textBoxTimeline.Text = string.Empty;
                textBoxTimeline.Text = "> Connect." + Environment.NewLine + textBoxTimeline.Text;

                Subscribe();

                buttonStart.Enabled = false;
                buttonStop.Enabled = true;
                buttonStop.Focus();
                textBoxPost.Enabled = true;
                buttonPost.Enabled = true;
                _formPostBar.textBoxPost.Enabled = true;
                _formPostBar.buttonPost.Enabled = true;
                textBoxTimeline.Text = "> Create subscription." + Environment.NewLine + textBoxTimeline.Text;
            }
            catch (Exception ex)
            {
                Debug.Print(ex.ToString());
                textBoxTimeline.Text = "> Could not start." + Environment.NewLine + textBoxTimeline.Text;
            }
        }
        #endregion

        #region 接続処理
        /// <summary>
        /// 接続処理
        /// </summary>
        /// <returns></returns>
        private async Task ConnectAsync()
        {
            if (null == _client)
            {
                _client = new NostrClient(new Uri(textBoxRelay.Text));
                await _client.Connect();
                _client.EventsReceived += OnClientOnEventsReceived;
            }
            else if (WebSocketState.CloseReceived < _client.State)
            {
                await _client.Connect();
            }
        }
        #endregion

        #region タイムライン購読処理
        /// <summary>
        /// タイムライン購読処理
        /// </summary>
        private void Subscribe()
        {
            if (null == _client)
            {
                return;
            }

            _ = _client.CreateSubscription(
                    _subscriptionId,
                    [
                        new NostrSubscriptionFilter()
                        {
                            Kinds = [1,7], // 1: テキストノート, 7: リアクション
                            Since = DateTimeOffset.Now - _timeSpan,
                        }
                    ]
                 );
        }
        #endregion

        #region イベント受信時処理
        /// <summary>
        /// イベント受信時処理
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="args"></param>
        private void OnClientOnEventsReceived(object? sender, (string subscriptionId, NostrEvent[] events) args)
        {
            // タイムライン購読
            if (args.subscriptionId == _subscriptionId)
            {
                foreach (var nostrEvent in args.events)
                {
                    var content = nostrEvent.Content;
                    if (content != null)
                    {
                        // 時間表示
                        DateTimeOffset time;
                        int hour;
                        int minute;
                        string timeString = "- ";
                        if (nostrEvent.CreatedAt != null)
                        {
                            time = (DateTimeOffset)nostrEvent.CreatedAt;
                            time = time.LocalDateTime;
                            hour = time.Hour;
                            minute = time.Minute;
                            timeString = string.Format("{0:D2}", hour) + ":" + string.Format("{0:D2}", minute);
                        }

                        // フォロイーチェック
                        string headMark = "-";
                        string speaker = "\\u\\p[1]\\s[10]";
                        if (_followeesHexs.Contains(nostrEvent.PublicKey))
                        {
                            headMark = "*";
                            // さくら側がしゃべる
                            speaker = "\\h\\p[0]\\s[0]";
                        }

                        // リアクション
                        if (7 == nostrEvent.Kind)
                        {
                            // ログイン済みで自分へのリアクション
                            if (!_npubHex.IsNullOrEmpty() && nostrEvent.GetTaggedPublicKeys().Contains(_npubHex))
                            {
                                // ユーザー表示名取得
                                string userName = GetUserName(nostrEvent.PublicKey);
                                // ユーザー表示名カット
                                if (userName.Length > _cutNameLength)
                                {
                                    userName = $"{userName[.._cutNameLength]}...";
                                }

                                // SSPに送る
                                if (null != _ds)
                                {
                                    SearchGhost();
                                    Dictionary<string, string> SSTPHeader = new(_baseSSTPHeader)
                                    {
                                        { "Reference1", "reaction" },
                                        { "Reference2", content },
                                        { "Reference3", userName },
                                        { "Script", $"{speaker}リアクション {userName} {content}\\e" }
                                    };
                                    string sstpmsg = _SSTPMethod + "\r\n" + String.Join("\r\n", SSTPHeader.Select(kvp => kvp.Key + ": " + kvp.Value)) + "\r\n\r\n";
                                    string r = _ds.GetSSTPResponse(_ghostName, sstpmsg);
                                    Debug.WriteLine(r);
                                }
                                // 画面に表示
                                textBoxTimeline.Text = "+" + (_displayTime ? timeString : string.Empty)
                                             + " " + userName + " " + content + Environment.NewLine + textBoxTimeline.Text;
                            }
                        }
                        // テキストノート
                        if (1 == nostrEvent.Kind)
                        {
                            var c = nostrEvent.GetTaggedData("client");
                            var iSnokakoi = -1 < Array.IndexOf(c, "nokakoi");

                            // nokakoi限定表示オンでnokakoiじゃない時は表示しない
                            if (_showOnlyTagged && !iSnokakoi)
                            {
                                continue;
                            }

                            // 日本語限定表示オンので日本語じゃない時は表示しない
                            if (_showOnlyJapanese && "jpn" != DetermineLanguage(content))
                            {
                                continue;
                            }

                            // フォロイー限定表示オンのでフォロイーじゃない時は表示しない
                            if (_showOnlyFollowees && !_followeesHexs.Contains(nostrEvent.PublicKey))
                            {
                                continue;
                            }

                            // ミュートされている時は表示しない
                            if (IsMuted(nostrEvent.PublicKey))
                            {
                                continue;
                            }

                            // ユーザー表示名取得（ユーザー辞書メモリ節約のため↑のフラグ処理後に）
                            string userName = GetUserName(nostrEvent.PublicKey);
                            // ユーザー表示名カット
                            if (userName.Length > _cutNameLength)
                            {
                                userName = $"{userName[.._cutNameLength]}...";
                            }

                            // SSPに送る
                            if (null != _ds)
                            {
                                SearchGhost();

                                string msg = content;
                                // 本文カット
                                if (msg.Length > _cutLength)
                                {
                                    msg = $"{msg[.._cutLength]}...";//\\u\\p[1]\\s[10]長いよっ！";
                                }
                                Dictionary<string, string> SSTPHeader = new(_baseSSTPHeader)
                                {
                                    { "Reference1", "note" },
                                    { "Reference2", content },
                                    { "Reference3", userName },
                                    { "Script", $"{speaker}{userName}\\n{msg}\\e" }
                                };
                                string sstpmsg = _SSTPMethod + "\r\n" + String.Join("\r\n", SSTPHeader.Select(kvp => kvp.Key + ": " + kvp.Value)) + "\r\n\r\n";
                                string r = _ds.GetSSTPResponse(_ghostName, sstpmsg);
                                Debug.WriteLine(r);
                            }

                            // エスケープ解除（↑SSPにはエスケープされたまま送る）
                            content = Regex.Unescape(content);

                            // キーワード通知
                            var settings = Notifier.Settings;
                            if (Notifier.CheckPost(content) && settings.Open)
                            {
                                NIP19.NostrEventNote nostrEventNote = new()
                                {
                                    EventId = nostrEvent.Id,
                                    Relays = [textBoxRelay.Text]
                                };
                                var nevent = nostrEventNote.ToNIP19();
                                var app = new ProcessStartInfo
                                {
                                    FileName = settings.FileName + nevent,
                                    UseShellExecute = true
                                };
                                try
                                {
                                    Process.Start(app);
                                }
                                catch (Exception ex)
                                {
                                    Debug.WriteLine(ex.Message);
                                }
                            }

                            // 改行をスペースに置き換え
                            content = content.Replace('\n', ' ');
                            // 本文カット
                            if (content.Length > _cutLength)
                            {
                                content = $"{content[.._cutLength]}...";
                            }
                            // 画面に表示
                            textBoxTimeline.Text = (iSnokakoi ? "[n]" : string.Empty) + headMark
                                                 + (_displayTime ? $"{timeString} {userName}{Environment.NewLine}" : string.Empty)
                                                 + " " + content + Environment.NewLine + textBoxTimeline.Text;
                        }
                    }
                }
            }
            // フォロイー購読
            else if (args.subscriptionId == _getFollowsSubscriptionId)
            {
                foreach (var nostrEvent in args.events)
                {
                    // フォローリスト
                    if (3 == nostrEvent.Kind)
                    {
                        var tags = nostrEvent.Tags;
                        foreach (var tag in tags)
                        {
                            // 公開鍵を保存
                            if ("p" == tag.TagIdentifier)
                            {
                                // 先頭を公開鍵と決めつけているが…
                                _followeesHexs.Add(tag.Data[0]);
                            }
                        }
                        // プロフィールを購読する
                        SubscribeProfiles([.. _followeesHexs]);
                    }
                }
            }
            // プロフィール購読
            else if (args.subscriptionId == _getProfilesSubscriptionId)
            {
                foreach (var nostrEvent in args.events)
                {
                    // プロフィール
                    if (0 == nostrEvent.Kind && null != nostrEvent.Content)
                    {
                        //// ※nostrEvent.Contentがnullになってしまう特定ユーザーがいる。ライブラリの問題か。

                        // エスケープされているので解除
                        var contentJson = Regex.Unescape(nostrEvent.Content);
                        var user = Tools.JsonToUser(contentJson);

                        // 辞書に追加（上書き）
                        Users[nostrEvent.PublicKey] = user;
                        Debug.WriteLine($"{nostrEvent.PublicKey} {user?.DisplayName} @{user?.Name}");
                    }
                }
            }
        }
        #endregion

        #region Stopボタン
        // Stopボタン
        private void ButtonStop_Click(object sender, EventArgs e)
        {
            if (null == _client)
            {
                return;
            }

            try
            {
                _ = _client.CloseSubscription(_subscriptionId);
                _ = _client.CloseSubscription(_getFollowsSubscriptionId);
                _ = _client.CloseSubscription(_getProfilesSubscriptionId);
                textBoxTimeline.Text = "> Close subscription." + Environment.NewLine + textBoxTimeline.Text;
                _ = _client.Disconnect();
                textBoxTimeline.Text = "> Disconnect." + Environment.NewLine + textBoxTimeline.Text;
                _client.Dispose();
                _client = null;

                textBoxRelay.ForeColor = SystemColors.WindowText;
                buttonStart.Enabled = true;
                buttonStart.Focus();
                buttonStop.Enabled = false;
                textBoxPost.Enabled = false;
                buttonPost.Enabled = false;
                _formPostBar.textBoxPost.Enabled = false;
                _formPostBar.buttonPost.Enabled = false;
            }
            catch (Exception ex)
            {
                Debug.Print(ex.ToString());
                textBoxTimeline.Text = "> Could not stop." + Environment.NewLine + textBoxTimeline.Text;
            }
        }
        #endregion

        #region Postボタン
        // Postボタン
        internal void ButtonPost_Click(object sender, EventArgs e)
        {
            if (0 == _formSetting.textBoxNokakoiKey.TextLength || 0 == _formSetting.textBoxPassword.TextLength)
            {
                textBoxTimeline.Text = "> Please set noskoi-key and password." + Environment.NewLine + textBoxTimeline.Text;
                return;
            }
            if (0 == textBoxPost.TextLength)
            {
                textBoxTimeline.Text = "> Cannot post empty." + Environment.NewLine + textBoxTimeline.Text;
                return;
            }

            try
            {
                _ = PostAsync();

                textBoxPost.Text = string.Empty;
                _formPostBar.textBoxPost.Text = string.Empty;
            }
            catch (Exception ex)
            {
                Debug.Print(ex.ToString());
                textBoxTimeline.Text = "> Could not post." + Environment.NewLine + textBoxTimeline.Text;
            }

            if (checkBoxPostBar.Checked)
            {
                _formPostBar.textBoxPost.Focus();
            }
            else
            {
                textBoxPost.Focus();
            }
        }
        #endregion

        #region 投稿処理
        /// <summary>
        /// 投稿処理
        /// </summary>
        /// <returns></returns>
        private async Task PostAsync()
        {
            if (null == _client)
            {
                return;
            }
            // create tags
            List<NostrEventTag> tags = [];
            if (_addClient)
            {
                tags.Add(new NostrEventTag() { TagIdentifier = "client", Data = ["nokakoi"] });
            }
            if (_addShortcode)
            {
                tags.Add(new NostrEventTag() { TagIdentifier = "emoji", Data = [$"{_shortcode}", $"{_emojiUrl}"] });
            }
            // create a new event
            var newEvent = new NostrEvent()
            {
                Kind = 1,
                Content = textBoxPost.Text
                            .Replace("\\n", "\r\n") // 本体の改行をポストバーのマルチラインに合わせる（順番大事）
                            .Replace("\\", "\\\\")  // \を投稿できるようにエスケープ
                            .Replace("\"", "\\\"")  // "を投稿できるようにエスケープ
                            .Replace("\r\n", "\\n") // 改行を投稿できるようにエスケープ
                            + (_addShortcode ? " :" + _shortcode + ":" : string.Empty),
                Tags = tags
            };

            try
            {
                // load from an nsec string
                var key = _nsec.FromNIP19Nsec();
                // sign the event
                await newEvent.ComputeIdAndSignAsync(key);
                // send the event
                await _client.SendEventsAndWaitUntilReceived([newEvent], CancellationToken.None);
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex.Message);
                textBoxTimeline.Text = "> Decryption failed." + Environment.NewLine + textBoxTimeline.Text;
            }
        }
        #endregion

        #region Settingボタン
        // Settingボタン
        private async void ButtonSetting_Click(object sender, EventArgs e)
        {
            // 開く前
            _formSetting.checkBoxTopMost.Checked = TopMost;
            _formSetting.textBoxCutLength.Text = _cutLength.ToString();
            _formSetting.textBoxCutNameLength.Text = _cutNameLength.ToString();
            _formSetting.trackBarOpacity.Value = (int)(Opacity * 100);
            _formSetting.checkBoxDisplayTime.Checked = _displayTime;
            _formSetting.checkBoxAddEndTag.Checked = _addShortcode;
            _formSetting.textBoxShortcode.Text = _shortcode;
            _formSetting.textBoxEmojiUrl.Text = _emojiUrl;
            _formSetting.checkBoxAddClient.Checked = _addClient;
            _formSetting.checkBoxShowOnlyTagged.Checked = _showOnlyTagged;
            _formSetting.checkBoxShowOnlyJapanese.Checked = _showOnlyJapanese;
            _formSetting.checkBoxShowOnlyFollowees.Checked = _showOnlyFollowees;
            _formSetting.textBoxNokakoiKey.Text = _nokakoiKey;
            _formSetting.textBoxPassword.Text = _password;

            // 開く
            _formSetting.ShowDialog(this);

            // 閉じた後
            TopMost = _formSetting.checkBoxTopMost.Checked;
            if (!int.TryParse(_formSetting.textBoxCutLength.Text, out _cutLength))
            {
                _cutLength = 40;
            }
            else if (_cutLength < 1)
            {
                _cutLength = 1;
            }
            if (!int.TryParse(_formSetting.textBoxCutNameLength.Text, out _cutNameLength))
            {
                _cutNameLength = 8;
            }
            else if (_cutNameLength < 1)
            {
                _cutNameLength = 1;
            }
            Opacity = _formSetting.trackBarOpacity.Value / 100.0;
            _formPostBar.Opacity = Opacity;
            _displayTime = _formSetting.checkBoxDisplayTime.Checked;
            _addShortcode = _formSetting.checkBoxAddEndTag.Checked;
            _shortcode = _formSetting.textBoxShortcode.Text;
            _emojiUrl = _formSetting.textBoxEmojiUrl.Text;
            _addClient = _formSetting.checkBoxAddClient.Checked;
            _showOnlyTagged = _formSetting.checkBoxShowOnlyTagged.Checked;
            _showOnlyJapanese = _formSetting.checkBoxShowOnlyJapanese.Checked;
            _showOnlyFollowees = _formSetting.checkBoxShowOnlyFollowees.Checked;
            _nokakoiKey = _formSetting.textBoxNokakoiKey.Text;
            _password = _formSetting.textBoxPassword.Text;
            try
            {
                // 別アカウントログイン失敗に備えてクリアしておく
                _nsec = string.Empty;
                _npubHex = string.Empty;
                //_npub = string.Empty;
                _followeesHexs.Clear();

                // 秘密鍵と公開鍵取得
                _nsec = NokakoiCrypt.DecryptNokakoiKey(_nokakoiKey, _password);
                _npubHex = _nsec.GetNpubHex();
                //_npub = _npubHex.ConvertToNpub();

                // ログイン済みの時
                if (!_npubHex.IsNullOrEmpty())
                {
                    if (null == _client)
                    {
                        _client = new NostrClient(new Uri(textBoxRelay.Text));
                        await _client.Connect();
                        _client.EventsReceived += OnClientOnEventsReceived;
                    }
                    else if (WebSocketState.CloseReceived < _client.State)
                    {
                        await _client.Connect();
                    }
                    // フォロイーを購読をする
                    SubscribeFollows(_npubHex);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex.Message);
                textBoxTimeline.Text = "> Decryption failed." + Environment.NewLine + textBoxTimeline.Text;
            }

            Setting.TopMost = TopMost;
            Setting.CutLength = _cutLength;
            Setting.CutNameLength = _cutNameLength;
            Setting.Opacity = Opacity;
            Setting.DisplayTime = _displayTime;
            Setting.AddShortcode = _addShortcode;
            Setting.Shortcode = _shortcode;
            Setting.EmojiUrl = _emojiUrl;
            Setting.AddClient = _addClient;
            Setting.ShowOnlyTagged = _showOnlyTagged;
            Setting.ShowOnlyJapanese = _showOnlyJapanese;
            Setting.ShowOnlyFollowees = _showOnlyFollowees;
            Setting.NokakoiKey = _nokakoiKey;

            Setting.Save("nokakoi.config");
        }
        #endregion

        #region フォロイー購読処理
        /// <summary>
        /// フォロイー購読処理
        /// </summary>
        /// <param name="author"></param>
        private void SubscribeFollows(string author)
        {
            if (null == _client)
            {
                return;
            }

            _ = _client.CreateSubscription(
                    _getFollowsSubscriptionId,
                    [
                        new NostrSubscriptionFilter
                        {
                            Kinds = [3],
                            Authors = [author]
                        }
                    ]
                 );
        }
        #endregion

        #region プロフィール購読処理
        /// <summary>
        /// プロフィール購読処理
        /// </summary>
        /// <param name="authors"></param>
        private void SubscribeProfiles(string[] authors)
        {
            if (null == _client)
            {
                return;
            }

            _ = _client.CreateSubscription(
                    _getProfilesSubscriptionId,
                    [
                        new NostrSubscriptionFilter
                        {
                            Kinds = [0],
                            Authors = authors
                        }
                    ]
                 );
        }
        #endregion

        #region 透明解除処理
        // マウス入った時
        private void TextBoxTimeline_MouseEnter(object sender, EventArgs e)
        {
            _tempOpacity = Opacity;
            Opacity = 1.00;
        }

        // マウス出た時
        private void TextBoxTimeline_MouseLeave(object sender, EventArgs e)
        {
            Opacity = _tempOpacity;
        }
        #endregion

        #region SSPゴースト名を取得する
        /// <summary>
        /// SSPゴースト名を取得する
        /// </summary>
        private void SearchGhost()
        {
            _ds.Update();
            SakuraFMO fmo = (SakuraFMO)_ds.FMO;
            var names = fmo.GetGhostNames();
            if (names.Length > 0)
            {
                _ghostName = names.First(); // とりあえず先頭で
                Debug.Print(_ghostName);
            }
            else
            {
                _ghostName = string.Empty;
                Debug.Print("ゴーストがいません");
            }
        }
        #endregion

        #region 言語判定
        /// <summary>
        /// 言語判定
        /// </summary>
        /// <param name="text"></param>
        /// <returns></returns>
        private static string DetermineLanguage(string text)
        {
            var factory = new RankedLanguageIdentifierFactory();
            RankedLanguageIdentifier identifier;
            try
            {
                identifier = factory.Load("Core14.profile.xml");
            }
            catch (Exception)
            {
                return string.Empty;
            }
            var languages = identifier.Identify(text);
            var mostCertainLanguage = languages.FirstOrDefault();
            if (mostCertainLanguage != null)
            {
                return mostCertainLanguage.Item1.Iso639_3;
            }
            else
            {
                return string.Empty;
            }
        }
        #endregion

        #region ユーザー表示名を取得する
        /// <summary>
        /// ユーザー表示名を取得する
        /// </summary>
        /// <param name="publicKeyHex">公開鍵HEX</param>
        /// <returns>ユーザー表示名</returns>
        private string GetUserName(string publicKeyHex)
        {
            /*
            // 辞書にない場合プロフィールを購読する
            if (!_users.TryGetValue(publicKeyHex, out User? user))
            {
                SubscribeProfiles([publicKeyHex]);
            }
            */
            // kind 0 を毎回購読するように変更（頻繁にdisplay_name等を変更するユーザーがいるため）
            Users.TryGetValue(publicKeyHex, out User? user);
            SubscribeProfiles([publicKeyHex]);

            // 情報があれば表示名を取得
            string? userName = "???";
            if (null != user)
            {
                userName = user.DisplayName;
                // display_nameが無い場合は@nameとする
                if (null == userName || string.Empty == userName)
                {
                    userName = $"@{user.Name}";
                }
            }
            return userName;
        }
        #endregion

        #region ミュートされているか確認する
        /// <summary>
        /// ミュートされているか確認する
        /// </summary>
        /// <param name="publicKeyHex">公開鍵HEX</param>
        /// <returns>ミュートフラグ</returns>
        private bool IsMuted(string publicKeyHex)
        {
            if (Users.TryGetValue(publicKeyHex, out User? user))
            {
                if (null != user)
                {
                    return user.Mute;
                }
            }
            return false;
        }
        #endregion

        #region 閉じる
        // 閉じる
        private void FormMain_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (FormWindowState.Normal != WindowState)
            {
                // 最小化最大化状態の時、元の位置と大きさを保存
                Setting.Location = RestoreBounds.Location;
                Setting.Size = RestoreBounds.Size;
            }
            else
            {
                Setting.Location = Location;
                Setting.Size = Size;
            }
            Setting.PostBarLocation = _formPostBar.Location;
            Setting.PostBarSize = _formPostBar.Size;
            Setting.Relay = textBoxRelay.Text;
            Setting.Save("nokakoi.config");
            Tools.SaveUsers(Users);
            Notifier.SaveSettings(); // 必要ないが更新日時をそろえるため

            _ds.Dispose();      // FrmMsgReceiverのThread停止せず1000ms待たされるうえにプロセス残るので…
            Application.Exit(); // ←これで殺す。SSTLibに手を入れた方がいいが、とりあえず。
        }
        #endregion

        #region ロード時
        // ロード時
        private void FormMain_Load(object sender, EventArgs e)
        {
            _formPostBar.ShowDialog();
            ButtonStart_Click(sender, e);
        }
        #endregion

        #region ポストバー表示切り替え
        // ポストバー表示切り替え
        private void CheckBoxPostBar_CheckedChanged(object sender, EventArgs e)
        {
            _formPostBar.Visible = checkBoxPostBar.Checked;
        }
        #endregion

        #region CTRL + ENTERで投稿
        // CTRL + ENTERで投稿
        private void TextBoxPost_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyData == (Keys.Enter | Keys.Control))
            {
                ButtonPost_Click(sender, e);
            }
        }
        #endregion

        #region 画面表示切替
        // 画面表示切替
        private void FormMain_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.F11 || e.KeyCode == Keys.F12)
            {
                checkBoxPostBar.Checked = !checkBoxPostBar.Checked;
            }
            if (e.KeyCode == Keys.Escape)
            {
                ButtonSetting_Click(sender, e);
            }
            if (e.KeyCode == Keys.F10)
            {
                var ev = new MouseEventArgs(MouseButtons.Right, 1, 0, 0, 0);
                FormMain_MouseClick(sender, ev);
            }
        }
        #endregion

        #region マニアクス表示
        private void FormMain_MouseClick(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Right)
            {
                if (null == _formManiacs || _formManiacs.IsDisposed)
                {
                    _formManiacs = new FormManiacs
                    {
                        MainForm = this
                    };
                }
                if (!_formManiacs.Visible)
                {
                    _formManiacs.Show(this);
                }
            }
        }
        #endregion
    }
}
