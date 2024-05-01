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
        #region �����o�[�ϐ�
        private readonly TimeSpan _timeSpan = new(0, 0, 0, 0);
        private readonly FormSetting _formSetting = new();
        private readonly FormPostBar _formPostBar = new();
        private FormManiacs _formManiacs = new();

        private NostrClient? _client;
        /// <summary>
        /// �^�C�����C���w��ID
        /// </summary>
        private readonly string _subscriptionId = Guid.NewGuid().ToString("N");
        /// <summary>
        /// �t�H���C�[�w��ID
        /// </summary>
        private readonly string _getFollowsSubscriptionId = Guid.NewGuid().ToString("N");
        /// <summary>
        /// �v���t�B�[���w��ID
        /// </summary>
        private readonly string _getProfilesSubscriptionId = Guid.NewGuid().ToString("N");

        private string _nsec = string.Empty;
        //private string _npub = string.Empty;
        private string _npubHex = string.Empty;

        /// <summary>
        /// �t�H���C�[���J���̃n�b�V���Z�b�g
        /// </summary>
        private readonly HashSet<string> _followeesHexs = [];
        /// <summary>
        /// ���[�U�[����
        /// </summary>
        internal Dictionary<string, User?> Users = [];
        /// <summary>
        /// �L�[���[�h�ʒm
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

        #region �R���X�g���N�^
        // �R���X�g���N�^
        public FormMain()
        {
            InitializeComponent();

            // �{�^���̉摜��DPI�ɍ��킹�ĕ\��
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

        #region Start�{�^��
        // Start�{�^��
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

        #region �ڑ�����
        /// <summary>
        /// �ڑ�����
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

        #region �^�C�����C���w�Ǐ���
        /// <summary>
        /// �^�C�����C���w�Ǐ���
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
                            Kinds = [1,7], // 1: �e�L�X�g�m�[�g, 7: ���A�N�V����
                            Since = DateTimeOffset.Now - _timeSpan,
                        }
                    ]
                 );
        }
        #endregion

        #region �C�x���g��M������
        /// <summary>
        /// �C�x���g��M������
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="args"></param>
        private void OnClientOnEventsReceived(object? sender, (string subscriptionId, NostrEvent[] events) args)
        {
            // �^�C�����C���w��
            if (args.subscriptionId == _subscriptionId)
            {
                foreach (var nostrEvent in args.events)
                {
                    var content = nostrEvent.Content;
                    if (content != null)
                    {
                        // ���ԕ\��
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

                        // �t�H���C�[�`�F�b�N
                        string headMark = "-";
                        string speaker = "\\u\\p[1]\\s[10]";
                        if (_followeesHexs.Contains(nostrEvent.PublicKey))
                        {
                            headMark = "*";
                            // �����瑤������ׂ�
                            speaker = "\\h\\p[0]\\s[0]";
                        }

                        // ���A�N�V����
                        if (7 == nostrEvent.Kind)
                        {
                            // ���O�C���ς݂Ŏ����ւ̃��A�N�V����
                            if (!_npubHex.IsNullOrEmpty() && nostrEvent.GetTaggedPublicKeys().Contains(_npubHex))
                            {
                                // ���[�U�[�\�����擾
                                string userName = GetUserName(nostrEvent.PublicKey);
                                // ���[�U�[�\�����J�b�g
                                if (userName.Length > _cutNameLength)
                                {
                                    userName = $"{userName[.._cutNameLength]}...";
                                }

                                // SSP�ɑ���
                                if (null != _ds)
                                {
                                    SearchGhost();
                                    Dictionary<string, string> SSTPHeader = new(_baseSSTPHeader)
                                    {
                                        { "Reference1", "reaction" },
                                        { "Reference2", content },
                                        { "Reference3", userName },
                                        { "Script", $"{speaker}���A�N�V���� {userName} {content}\\e" }
                                    };
                                    string sstpmsg = _SSTPMethod + "\r\n" + String.Join("\r\n", SSTPHeader.Select(kvp => kvp.Key + ": " + kvp.Value)) + "\r\n\r\n";
                                    string r = _ds.GetSSTPResponse(_ghostName, sstpmsg);
                                    Debug.WriteLine(r);
                                }
                                // ��ʂɕ\��
                                textBoxTimeline.Text = "+" + (_displayTime ? timeString : string.Empty)
                                             + " " + userName + " " + content + Environment.NewLine + textBoxTimeline.Text;
                            }
                        }
                        // �e�L�X�g�m�[�g
                        if (1 == nostrEvent.Kind)
                        {
                            var c = nostrEvent.GetTaggedData("client");
                            var iSnokakoi = -1 < Array.IndexOf(c, "nokakoi");

                            // nokakoi����\���I����nokakoi����Ȃ����͕\�����Ȃ�
                            if (_showOnlyTagged && !iSnokakoi)
                            {
                                continue;
                            }

                            // ���{�����\���I���̂œ��{�ꂶ��Ȃ����͕\�����Ȃ�
                            if (_showOnlyJapanese && "jpn" != DetermineLanguage(content))
                            {
                                continue;
                            }

                            // �t�H���C�[����\���I���̂Ńt�H���C�[����Ȃ����͕\�����Ȃ�
                            if (_showOnlyFollowees && !_followeesHexs.Contains(nostrEvent.PublicKey))
                            {
                                continue;
                            }

                            // �~���[�g����Ă��鎞�͕\�����Ȃ�
                            if (IsMuted(nostrEvent.PublicKey))
                            {
                                continue;
                            }

                            // ���[�U�[�\�����擾�i���[�U�[�����������ߖ�̂��߁��̃t���O������Ɂj
                            string userName = GetUserName(nostrEvent.PublicKey);
                            // ���[�U�[�\�����J�b�g
                            if (userName.Length > _cutNameLength)
                            {
                                userName = $"{userName[.._cutNameLength]}...";
                            }

                            // SSP�ɑ���
                            if (null != _ds)
                            {
                                SearchGhost();

                                string msg = content;
                                // �{���J�b�g
                                if (msg.Length > _cutLength)
                                {
                                    msg = $"{msg[.._cutLength]}...";//\\u\\p[1]\\s[10]��������I";
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

                            // �G�X�P�[�v�����i��SSP�ɂ̓G�X�P�[�v���ꂽ�܂ܑ���j
                            content = Regex.Unescape(content);

                            // �L�[���[�h�ʒm
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

                            // ���s���X�y�[�X�ɒu������
                            content = content.Replace('\n', ' ');
                            // �{���J�b�g
                            if (content.Length > _cutLength)
                            {
                                content = $"{content[.._cutLength]}...";
                            }
                            // ��ʂɕ\��
                            textBoxTimeline.Text = (iSnokakoi ? "[n]" : string.Empty) + headMark
                                                 + (_displayTime ? $"{timeString} {userName}{Environment.NewLine}" : string.Empty)
                                                 + " " + content + Environment.NewLine + textBoxTimeline.Text;
                        }
                    }
                }
            }
            // �t�H���C�[�w��
            else if (args.subscriptionId == _getFollowsSubscriptionId)
            {
                foreach (var nostrEvent in args.events)
                {
                    // �t�H���[���X�g
                    if (3 == nostrEvent.Kind)
                    {
                        var tags = nostrEvent.Tags;
                        foreach (var tag in tags)
                        {
                            // ���J����ۑ�
                            if ("p" == tag.TagIdentifier)
                            {
                                // �擪�����J���ƌ��߂��Ă��邪�c
                                _followeesHexs.Add(tag.Data[0]);
                            }
                        }
                        // �v���t�B�[�����w�ǂ���
                        SubscribeProfiles([.. _followeesHexs]);
                    }
                }
            }
            // �v���t�B�[���w��
            else if (args.subscriptionId == _getProfilesSubscriptionId)
            {
                foreach (var nostrEvent in args.events)
                {
                    // �v���t�B�[��
                    if (0 == nostrEvent.Kind && null != nostrEvent.Content)
                    {
                        //// ��nostrEvent.Content��null�ɂȂ��Ă��܂����胆�[�U�[������B���C�u�����̖�肩�B

                        // �G�X�P�[�v����Ă���̂ŉ���
                        var contentJson = Regex.Unescape(nostrEvent.Content);
                        var user = Tools.JsonToUser(contentJson);

                        // �����ɒǉ��i�㏑���j
                        Users[nostrEvent.PublicKey] = user;
                        Debug.WriteLine($"{nostrEvent.PublicKey} {user?.DisplayName} @{user?.Name}");
                    }
                }
            }
        }
        #endregion

        #region Stop�{�^��
        // Stop�{�^��
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

        #region Post�{�^��
        // Post�{�^��
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

        #region ���e����
        /// <summary>
        /// ���e����
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
                            .Replace("\\n", "\r\n") // �{�̂̉��s���|�X�g�o�[�̃}���`���C���ɍ��킹��i���ԑ厖�j
                            .Replace("\\", "\\\\")  // \�𓊍e�ł���悤�ɃG�X�P�[�v
                            .Replace("\"", "\\\"")  // "�𓊍e�ł���悤�ɃG�X�P�[�v
                            .Replace("\r\n", "\\n") // ���s�𓊍e�ł���悤�ɃG�X�P�[�v
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

        #region Setting�{�^��
        // Setting�{�^��
        private async void ButtonSetting_Click(object sender, EventArgs e)
        {
            // �J���O
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

            // �J��
            _formSetting.ShowDialog(this);

            // ������
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
                // �ʃA�J�E���g���O�C�����s�ɔ����ăN���A���Ă���
                _nsec = string.Empty;
                _npubHex = string.Empty;
                //_npub = string.Empty;
                _followeesHexs.Clear();

                // �閧���ƌ��J���擾
                _nsec = NokakoiCrypt.DecryptNokakoiKey(_nokakoiKey, _password);
                _npubHex = _nsec.GetNpubHex();
                //_npub = _npubHex.ConvertToNpub();

                // ���O�C���ς݂̎�
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
                    // �t�H���C�[���w�ǂ�����
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

        #region �t�H���C�[�w�Ǐ���
        /// <summary>
        /// �t�H���C�[�w�Ǐ���
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

        #region �v���t�B�[���w�Ǐ���
        /// <summary>
        /// �v���t�B�[���w�Ǐ���
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

        #region ������������
        // �}�E�X��������
        private void TextBoxTimeline_MouseEnter(object sender, EventArgs e)
        {
            _tempOpacity = Opacity;
            Opacity = 1.00;
        }

        // �}�E�X�o����
        private void TextBoxTimeline_MouseLeave(object sender, EventArgs e)
        {
            Opacity = _tempOpacity;
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

        #region ���ꔻ��
        /// <summary>
        /// ���ꔻ��
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

        #region ���[�U�[�\�������擾����
        /// <summary>
        /// ���[�U�[�\�������擾����
        /// </summary>
        /// <param name="publicKeyHex">���J��HEX</param>
        /// <returns>���[�U�[�\����</returns>
        private string GetUserName(string publicKeyHex)
        {
            /*
            // �����ɂȂ��ꍇ�v���t�B�[�����w�ǂ���
            if (!_users.TryGetValue(publicKeyHex, out User? user))
            {
                SubscribeProfiles([publicKeyHex]);
            }
            */
            // kind 0 �𖈉�w�ǂ���悤�ɕύX�i�p�ɂ�display_name����ύX���郆�[�U�[�����邽�߁j
            Users.TryGetValue(publicKeyHex, out User? user);
            SubscribeProfiles([publicKeyHex]);

            // ��񂪂���Ε\�������擾
            string? userName = "???";
            if (null != user)
            {
                userName = user.DisplayName;
                // display_name�������ꍇ��@name�Ƃ���
                if (null == userName || string.Empty == userName)
                {
                    userName = $"@{user.Name}";
                }
            }
            return userName;
        }
        #endregion

        #region �~���[�g����Ă��邩�m�F����
        /// <summary>
        /// �~���[�g����Ă��邩�m�F����
        /// </summary>
        /// <param name="publicKeyHex">���J��HEX</param>
        /// <returns>�~���[�g�t���O</returns>
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
            Tools.SaveUsers(Users);
            Notifier.SaveSettings(); // �K�v�Ȃ����X�V���������낦�邽��

            _ds.Dispose();      // FrmMsgReceiver��Thread��~����1000ms�҂�����邤���Ƀv���Z�X�c��̂Łc
            Application.Exit(); // ������ŎE���BSSTLib�Ɏ����ꂽ�����������A�Ƃ肠�����B
        }
        #endregion

        #region ���[�h��
        // ���[�h��
        private void FormMain_Load(object sender, EventArgs e)
        {
            _formPostBar.ShowDialog();
            ButtonStart_Click(sender, e);
        }
        #endregion

        #region �|�X�g�o�[�\���؂�ւ�
        // �|�X�g�o�[�\���؂�ւ�
        private void CheckBoxPostBar_CheckedChanged(object sender, EventArgs e)
        {
            _formPostBar.Visible = checkBoxPostBar.Checked;
        }
        #endregion

        #region CTRL + ENTER�œ��e
        // CTRL + ENTER�œ��e
        private void TextBoxPost_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyData == (Keys.Enter | Keys.Control))
            {
                ButtonPost_Click(sender, e);
            }
        }
        #endregion

        #region ��ʕ\���ؑ�
        // ��ʕ\���ؑ�
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

        #region �}�j�A�N�X�\��
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
