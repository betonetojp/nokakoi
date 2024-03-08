using NNostr.Client;
using NNostr.Client.Protocols;
using NTextCat;
using NTextCat.Commons;
using SSTPLib;
using System.Diagnostics;
using System.Text.RegularExpressions;

namespace nokakoi
{
    public partial class FormMain : Form
    {
        private readonly TimeSpan _timeSpan = new(0, 0, 0, 0);
        private readonly FormSetting _formSetting = new();

        private NostrClient? _client;
        private string _subscriptionId = string.Empty;
        private string _nsec = string.Empty;
        private string _npub = string.Empty;

        private int _cutLength;
        private bool _displayTime;
        private bool _addShortcode;
        private string _shortcode = string.Empty;
        private string _emojiUrl = string.Empty;
        private bool _addClient;
        private bool _showOnlyTagged;
        private bool _showOnlyJapanese;
        private string _nokakoiKey = string.Empty;
        private string _password = string.Empty;

        private double _tempOpacity = 1.00;

        private readonly DSSTPSender _ds = new("SakuraUnicode");
        private readonly string _mesHeader = "SEND SSTP/1.0\r\nCharset: UTF-8\r\nSender: nokakoi\r\nOption: nobreak\r\nScript: ";
        private string _ghostName = string.Empty;

        #region コンストラクタ
        // コンストラクタ
        public FormMain()
        {
            InitializeComponent();

            Setting.Load("nokakoi.config");

            // 最小化状態で閉じられた時の暫定対応
            if (Setting.Location.X < 0 || Setting.Location.Y < 0)
            {
                Setting.Location = new Point(0, 0);
            }
            Location = Setting.Location;
            // 設定ファイルがない時の初期サイズ
            if (Setting.Size.Width < 200 || Setting.Size.Height < 200)
            {
                Setting.Size = new Size(320, 320);
            }
            Size = Setting.Size;
            textBoxRelay.Text = Setting.Relay;
            TopMost = Setting.TopMost;
            _cutLength = Setting.CutLength;
            Opacity = Setting.Opacity;
            if (0 == Opacity) { Opacity = 1; }
            _displayTime = Setting.DisplayTime;
            _addShortcode = Setting.AddShortcode;
            _shortcode = Setting.Shortcode;
            _emojiUrl = Setting.EmojiUrl;
            _addClient = Setting.AddClient;
            _showOnlyTagged = Setting.ShowOnlyTagged;
            _showOnlyJapanese = Setting.ShowOnlyJapanese;
            _nokakoiKey = Setting.NokakoiKey;
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

        #region Connectボタン
        // Connectボタン
        private void buttonConnect_Click(object sender, EventArgs e)
        {
            try
            {
                _ = ConnectAsync();

                textBoxRelay.ForeColor = SystemColors.GrayText;
                buttonConnect.Enabled = false;
                buttonStart.Enabled = true;
                buttonStart.Focus();
                textBoxTimeline.Text = string.Empty;
                textBoxTimeline.Text = "> Connect." + Environment.NewLine + textBoxTimeline.Text;
            }
            catch (Exception ex)
            {
                Debug.Print(ex.ToString());
                textBoxTimeline.Text = "> Could not connect." + Environment.NewLine + textBoxTimeline.Text;
            }
        }
        #endregion

        #region 接続処理
        // 接続処理
        private async Task ConnectAsync()
        {
            _subscriptionId = Guid.NewGuid().ToString("N");
            _client = new NostrClient(new Uri(textBoxRelay.Text));

            await _client.Connect();
        }
        #endregion

        #region Startボタン
        // Startボタン
        private void buttonStart_Click(object sender, EventArgs e)
        {
            try
            {
                _ = StartAsync();

                buttonStart.Enabled = false;
                buttonStop.Enabled = true;
                buttonStop.Focus();
                buttonPost.Enabled = true;
                textBoxTimeline.Text = "> Create subscription." + Environment.NewLine + textBoxTimeline.Text;
            }
            catch (Exception ex)
            {
                Debug.Print(ex.ToString());
                textBoxTimeline.Text = "> Could not start." + Environment.NewLine + textBoxTimeline.Text;
            }
        }
        #endregion

        #region 購読処理
        // 購読処理
        private async Task StartAsync()
        {
            if (null == _client)
            {
                return;
            }

            await _client.CreateSubscription(
                    _subscriptionId,
                    [
                        new NostrSubscriptionFilter()
                        {
                            Kinds = [1,7], // 1: text note, 7: reaction
                            Since = DateTimeOffset.Now - _timeSpan,
                        }
                    ]
                 );

            _client.EventsReceived += OnClientOnEventsReceived;
        }
        #endregion

        #region イベント受信時処理
        // イベント受信時処理
        private void OnClientOnEventsReceived(object? sender, (string subscriptionId, NostrEvent[] events) args)
        {
            if (args.subscriptionId == _subscriptionId)
            {
                foreach (var nostrEvent in args.events)
                {
                    var content = nostrEvent.Content;

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

                    //  7: reaction
                    if (7 == nostrEvent.Kind)
                    {
                        if (!_npub.IsNullOrEmpty() && nostrEvent.GetTaggedPublicKeys().Contains(_npub.ConvertToHex()))
                        {
                            // SSPに送る
                            if (null != _ds)
                            {
                                SearchGhost();
                                string sstpmsg = $"{_mesHeader}\\uリアクション {content}\\e\r\n";
                                string r = _ds.GetSSTPResponse(_ghostName, sstpmsg);
                                Debug.WriteLine(r);
                            }

                            textBoxTimeline.Text = "+" + (_displayTime ? timeString : string.Empty)
                                         + " " + content + Environment.NewLine + textBoxTimeline.Text;
                        }
                    }
                    //  1: text note
                    if (1 == nostrEvent.Kind)
                    {
                        var c = nostrEvent.GetTaggedData("client");
                        var iSnokakoi = -1 < Array.IndexOf(c, "nokakoi");

                        if (_showOnlyTagged && !iSnokakoi)
                        {
                            // nokakoi限定表示オンでnokakoiじゃない時は表示しない
                            continue;
                        }

                        if (content != null)
                        {
                            if (_showOnlyJapanese && "jpn" != DetermineLanguage(content))
                            {
                                // 日本語限定表示オンので日本語じゃない時は表示しない
                                continue;
                            }

                            // SSPに送る
                            if (null != _ds)
                            {
                                SearchGhost();
                                string msg = content;
                                if (msg.Length > _cutLength) {
                                    msg = $"{msg[.._cutLength]}（以下略）";
                                }
                                string sstpmsg = $"{_mesHeader}\\h{msg}\\e\r\n";
                                string r = _ds.GetSSTPResponse(_ghostName, sstpmsg);
                                Debug.WriteLine(r);
                            }

                            content = Regex.Unescape(content);
                            content = content.Replace('\n', ' ');
                            if (content.Length > _cutLength)
                            {
                                content = $"{content[.._cutLength]} . . .";
                            }
                        }

                        textBoxTimeline.Text = (iSnokakoi ? "*" : "-") + (_displayTime ? timeString : string.Empty)
                                             + " " + content + Environment.NewLine + textBoxTimeline.Text;
                    }
                }
            }
        }
        #endregion

        #region Stopボタン
        // Stopボタン
        private void buttonStop_Click(object sender, EventArgs e)
        {
            if (null == _client)
            {
                return;
            }

            try
            {
                _ = _client.CloseSubscription(_subscriptionId);
                textBoxTimeline.Text = "> Close subscription." + Environment.NewLine + textBoxTimeline.Text;
                _ = _client.Disconnect();
                textBoxTimeline.Text = "> Disconnect." + Environment.NewLine + textBoxTimeline.Text;
                _client.Dispose();
                //textBoxTimeline.Text = "> Finish." + Environment.NewLine + textBoxTimeline.Text;

                textBoxRelay.ForeColor = SystemColors.WindowText;
                buttonConnect.Enabled = true;
                buttonConnect.Focus();
                buttonStop.Enabled = false;
                buttonPost.Enabled = false;
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
        private void buttonPost_Click(object sender, EventArgs e)
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
            }
            catch (Exception ex)
            {
                Debug.Print(ex.ToString());
                textBoxTimeline.Text = "> Could not post." + Environment.NewLine + textBoxTimeline.Text;
            }

            textBoxPost.Focus();
        }
        #endregion

        #region 投稿処理
        // 投稿処理
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
                Content = textBoxPost.Text + (_addShortcode ? " :" + _shortcode + ":" : string.Empty),
                Tags = tags
            };
            // load from an nsec string
            var key = _nsec.FromNIP19Nsec();
            // sign the event
            await newEvent.ComputeIdAndSignAsync(key);
            // send the event
            await _client.SendEventsAndWaitUntilReceived([newEvent], CancellationToken.None);
        }
        #endregion

        #region Settingボタン
        // Settingボタン
        private void buttonSetting_Click(object sender, EventArgs e)
        {
            // 開く前
            _formSetting.checkBoxTopMost.Checked = TopMost;
            _formSetting.textBoxCutLength.Text = _cutLength.ToString();
            _formSetting.trackBarOpacity.Value = (int)(Opacity * 100);
            _formSetting.checkBoxDisplayTime.Checked = _displayTime;
            _formSetting.checkBoxAddEndTag.Checked = _addShortcode;
            _formSetting.textBoxShortcode.Text = _shortcode;
            _formSetting.textBoxEmojiUrl.Text = _emojiUrl;
            _formSetting.checkBoxAddClient.Checked = _addClient;
            _formSetting.checkBoxShowOnlyTagged.Checked = _showOnlyTagged;
            _formSetting.checkBoxShowOnlyJapanese.Checked = _showOnlyJapanese;
            _formSetting.textBoxNokakoiKey.Text = _nokakoiKey;
            _formSetting.textBoxPassword.Text = _password;

            // 開く
            _formSetting.ShowDialog(this);

            // 閉じた後
            TopMost = _formSetting.checkBoxTopMost.Checked;
            if (!int.TryParse(_formSetting.textBoxCutLength.Text, out _cutLength))
            {
                _cutLength = 20;
            }
            else if (_cutLength < 1)
            {
                _cutLength = 1;
            }
            Opacity = _formSetting.trackBarOpacity.Value / 100.0;
            _displayTime = _formSetting.checkBoxDisplayTime.Checked;
            _addShortcode = _formSetting.checkBoxAddEndTag.Checked;
            _shortcode = _formSetting.textBoxShortcode.Text;
            _emojiUrl = _formSetting.textBoxEmojiUrl.Text;
            _addClient = _formSetting.checkBoxAddClient.Checked;
            _showOnlyTagged = _formSetting.checkBoxShowOnlyTagged.Checked;
            _showOnlyJapanese = _formSetting.checkBoxShowOnlyJapanese.Checked;
            _nokakoiKey = _formSetting.textBoxNokakoiKey.Text;
            _password = _formSetting.textBoxPassword.Text;
            try
            {
                _nsec = NokakoiCrypt.DecryptNokakoiKey(_nokakoiKey, _password);
                _npub = _nsec.GetNpub();
                //textBoxTimeline.Text = "> Welcome " + _npub + Environment.NewLine + textBoxTimeline.Text;
            }
            catch (Exception ex)
            {
                //MessageBox.Show("Decryption failed.");
                Debug.WriteLine(ex.Message);
                textBoxTimeline.Text = "> Decryption failed." + Environment.NewLine + textBoxTimeline.Text;
            }

            Setting.TopMost = TopMost;
            Setting.CutLength = _cutLength;
            Setting.Opacity = Opacity;
            Setting.DisplayTime = _displayTime;
            Setting.AddShortcode = _addShortcode;
            Setting.Shortcode = _shortcode;
            Setting.EmojiUrl = _emojiUrl;
            Setting.AddClient = _addClient;
            Setting.ShowOnlyTagged = _showOnlyTagged;
            Setting.ShowOnlyJapanese = _showOnlyJapanese;
            Setting.NokakoiKey = _nokakoiKey;

            Setting.Save("nokakoi.config");
        }
        #endregion

        #region 透明解除処理
        // マウス入った時
        private void textBoxTimeline_MouseEnter(object sender, EventArgs e)
        {
            _tempOpacity = Opacity;
            Opacity = 1.00;
        }

        // マウス出た時
        private void textBoxTimeline_MouseLeave(object sender, EventArgs e)
        {
            Opacity = _tempOpacity;
        }
        #endregion

        #region 言語判定
        // 言語判定
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

        #region 閉じる
        // 閉じる
        private void FormMain_FormClosing(object sender, FormClosingEventArgs e)
        {
            Setting.Location = Location;
            Setting.Size = Size;
            Setting.Relay = textBoxRelay.Text;
            Setting.Save("nokakoi.config");

            _ds?.Dispose();     // FrmMsgReceiverのThread停止せず1000ms待たされるうえにプロセス残るので…
            Application.Exit(); // ←これで殺す。SSTLibに手を入れた方がいいが、とりあえず。
        }
        #endregion
    }
}
