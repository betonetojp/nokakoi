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
        private readonly TimeSpan _timeSpan = new(0, 0, 0, 0);
        private readonly FormSetting _formSetting = new();
        private readonly FormPostBar _formPostBar = new();

        private NostrClient? _client;
        private string _subscriptionId = string.Empty;
        private string _nsec = string.Empty;
        private string _npub = string.Empty;
        private string _npubHex = string.Empty;
        private readonly string _getFollowsSubscriptionId = Guid.NewGuid().ToString("N");
        private readonly string _getProfilesSubscriptionId = Guid.NewGuid().ToString("N");
        private Dictionary<string, User?> _follows = [];

        private int _cutLength;
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
        private readonly string _mesHeader = "SEND SSTP/1.0\r\nCharset: UTF-8\r\nSender: nokakoi\r\nOption: nobreak\r\nScript: ";
        private string _ghostName = string.Empty;

        #region �R���X�g���N�^
        // �R���X�g���N�^
        public FormMain()
        {
            InitializeComponent();

            Setting.Load("nokakoi.config");

            Location = Setting.Location;
            if (new Point(0, 0) == Location)
            {
                StartPosition = FormStartPosition.CenterScreen;
            }
            Size = Setting.Size;
            textBoxRelay.Text = Setting.Relay;
            TopMost = Setting.TopMost;
            _cutLength = Setting.CutLength;
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

            _formSetting.FormPostBar = _formPostBar;
            _formPostBar.FormMain = this;
        }
        #endregion

        #region SSP�S�[�X�g�����擾����
        /// <summary>
        /// SSP�S�[�X�g�����擾����
        /// </summary>
        private void SearchGhost()
        {
            _ds.Update();
            SakuraFMO fmo = (SakuraFMO)_ds.FMO;
            var names = fmo.GetGhostNames();
            if (names.Length > 0)
            {
                _ghostName = names.First(); // �Ƃ肠�����擪��
                Debug.Print(_ghostName);
            }
            else
            {
                _ghostName = string.Empty;
                Debug.Print("�S�[�X�g�����܂���");
            }
        }
        #endregion

        #region Connect�{�^��
        // Connect�{�^��
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

        #region �ڑ�����
        // �ڑ�����
        private async Task ConnectAsync()
        {
            _subscriptionId = Guid.NewGuid().ToString("N");
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

        #region Start�{�^��
        // Start�{�^��
        private void buttonStart_Click(object sender, EventArgs e)
        {
            try
            {
                Subscribe();

                buttonStart.Enabled = false;
                buttonStop.Enabled = true;
                buttonStop.Focus();
                buttonPost.Enabled = true;
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

        #region �w�Ǐ���
        // �w�Ǐ���
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
                            Kinds = [1,7], // 1: �e�L�X�g�m�[�g, 7: ���A�N�V����
                            Since = DateTimeOffset.Now - _timeSpan,
                        }
                    ]
                 );
        }
        #endregion

        #region �C�x���g��M������
        // �C�x���g��M������
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

                    _follows.TryGetValue(nostrEvent.PublicKey, out User? user);
                    string? userInfo = "*UNK*";
                    string speaker = "\\u\\p[1]\\s[10]";
                    if (null != user)
                    {
                        userInfo = user.DisplayName ?? $"@{user.Name}";
                        speaker = "\\h\\p[0]\\s[0]";
                    }

                    // ���A�N�V����
                    if (7 == nostrEvent.Kind)
                    {
                        if (!_npubHex.IsNullOrEmpty() && nostrEvent.GetTaggedPublicKeys().Contains(_npubHex))
                        {
                            // SSP�ɑ���
                            if (null != _ds)
                            {
                                SearchGhost();
                                string sstpmsg = $"{_mesHeader}{speaker}���A�N�V���� {userInfo} {content}\\e\r\n";
                                string r = _ds.GetSSTPResponse(_ghostName, sstpmsg);
                                Debug.WriteLine(r);
                            }

                            textBoxTimeline.Text = "+" + (_displayTime ? timeString : string.Empty)
                                         + " " + userInfo + " " + content + Environment.NewLine + textBoxTimeline.Text;
                        }
                    }
                    // �e�L�X�g�m�[�g
                    if (1 == nostrEvent.Kind)
                    {
                        var c = nostrEvent.GetTaggedData("client");
                        var iSnokakoi = -1 < Array.IndexOf(c, "nokakoi");

                        if (_showOnlyTagged && !iSnokakoi)
                        {
                            // nokakoi����\���I����nokakoi����Ȃ����͕\�����Ȃ�
                            continue;
                        }

                        if (content != null)
                        {
                            if (_showOnlyJapanese && "jpn" != DetermineLanguage(content))
                            {
                                // ���{�����\���I���̂œ��{�ꂶ��Ȃ����͕\�����Ȃ�
                                continue;
                            }

                            if (_showOnlyFollowees && !_follows.ContainsKey(nostrEvent.PublicKey))
                            {
                                // �t�H���C�[����\���I���̂Ńt�H���C�[����Ȃ����͕\�����Ȃ�
                                continue;
                            }

                            // SSP�ɑ���
                            if (null != _ds)
                            {
                                SearchGhost();

                                string msg = content;
                                if (msg.Length > _cutLength)
                                {
                                    msg = $"{msg[.._cutLength]} . . .";//\\u\\p[1]\\s[10]��������I";
                                }
                                string sstpmsg = $"{_mesHeader}{speaker}{userInfo}\\n{msg}\\e\r\n";
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

                        textBoxTimeline.Text = (iSnokakoi ? "*" : "-")
                                             + (_displayTime ? $"{timeString} {userInfo}{Environment.NewLine}" : string.Empty)
                                             + " " + content + Environment.NewLine + textBoxTimeline.Text;
                    }
                }
            }
            else // ������Ɨ��\��
            {
                foreach (var nostrEvent in args.events)
                {
                    // �v���t�B�[��
                    if (0 == nostrEvent.Kind && null != nostrEvent.Content)
                    {
                        var contentJson = Regex.Unescape(nostrEvent.Content);
                        var user = Tools.JsonToUser(contentJson);
                        Debug.WriteLine($"{nostrEvent.PublicKey} {user?.DisplayName} @{user?.Name} {user?.Nip05}");
                        // �����ɒǉ�
                        _follows[nostrEvent.PublicKey] = user;
                    }

                    // �t�H���C�[
                    if (3 == nostrEvent.Kind)
                    {
                        HashSet<string> hexs = [];
                        var tags = nostrEvent.Tags;
                        foreach (var tag in tags)
                        {
                            if ("p" == tag.TagIdentifier)
                            {
                                _follows.TryAdd(tag.Data[0], null);
                                hexs.Add(tag.Data[0]);
                            }
                        }
                        // �v���t�B�[����v��
                        SubscribeProfiles([.. hexs]);
                    }
                }
            }
        }
        #endregion

        #region Stop�{�^��
        // Stop�{�^��
        private void buttonStop_Click(object sender, EventArgs e)
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
                buttonConnect.Enabled = true;
                buttonConnect.Focus();
                buttonStop.Enabled = false;
                buttonPost.Enabled = false;
                _formPostBar.buttonPost.Enabled = false;
            }
            catch (Exception ex)
            {
                Debug.Print(ex.ToString());
                textBoxTimeline.Text = "> Could not stop." + Environment.NewLine + textBoxTimeline.Text;
            }
        }
        #endregion

        #region Post�{�^��
        // Post�{�^��
        internal void buttonPost_Click(object sender, EventArgs e)
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

        #region ���e����
        // ���e����
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

        #region Setting�{�^��
        // Setting�{�^��
        private async void buttonSetting_Click(object sender, EventArgs e)
        {
            // �J���O
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
            _formSetting.checkBoxShowOnlyFollowees.Checked = _showOnlyFollowees;
            _formSetting.textBoxNokakoiKey.Text = _nokakoiKey;
            _formSetting.textBoxPassword.Text = _password;

            // �J��
            _formSetting.ShowDialog(this);

            // ������
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
                _nsec = string.Empty;
                _npubHex = string.Empty;
                _npub = string.Empty;
                _nsec = NokakoiCrypt.DecryptNokakoiKey(_nokakoiKey, _password);
                _npubHex = _nsec.GetNpubHex();
                _npub = _npubHex.ConvertToNpub();
                //textBoxTimeline.Text = "> Welcome " + _npub + Environment.NewLine + textBoxTimeline.Text;

                if (!_npubHex.IsNullOrEmpty())
                {
                    // �t�H���C�[��v��
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
                    SubscribeFollows(_npubHex);
                    //SubscribeProfiles([_npubHex]);
                }
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
            Setting.ShowOnlyFollowees = _showOnlyFollowees;
            Setting.NokakoiKey = _nokakoiKey;

            Setting.Save("nokakoi.config");
        }
        #endregion

        #region �t�H���C�[�w�Ǐ���
        // �t�H���C�[�w�Ǐ���
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

        #region �v���t�B�[���w�Ǐ���
        // �v���t�B�[���w�Ǐ���
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

        #region ������������
        // �}�E�X��������
        private void textBoxTimeline_MouseEnter(object sender, EventArgs e)
        {
            _tempOpacity = Opacity;
            Opacity = 1.00;
        }

        // �}�E�X�o����
        private void textBoxTimeline_MouseLeave(object sender, EventArgs e)
        {
            Opacity = _tempOpacity;
        }
        #endregion

        #region ���ꔻ��
        // ���ꔻ��
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

        #region ����
        // ����
        private void FormMain_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (FormWindowState.Normal != WindowState)
            {
                // �ŏ����ő剻��Ԃ̎��A���̈ʒu�Ƒ傫����ۑ�
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

            _ds?.Dispose();     // FrmMsgReceiver��Thread��~����1000ms�҂�����邤���Ƀv���Z�X�c��̂Łc
            Application.Exit(); // ������ŎE���BSSTLib�Ɏ����ꂽ�����������A�Ƃ肠�����B
        }
        #endregion

        private void FormMain_Load(object sender, EventArgs e)
        {
            _formPostBar.ShowDialog();
        }

        private void checkBoxPostBar_CheckedChanged(object sender, EventArgs e)
        {
            _formPostBar.Visible = checkBoxPostBar.Checked;
        }
    }
}
