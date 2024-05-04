namespace nokakoi
{
    partial class FormMain
    {
        /// <summary>
        ///  Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        ///  Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        ///  Required method for Designer support - do not modify
        ///  the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            components = new System.ComponentModel.Container();
            System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(FormMain));
            buttonStart = new Button();
            textBoxTimeline = new TextBox();
            buttonStop = new Button();
            textBoxPost = new TextBox();
            buttonPost = new Button();
            buttonSetting = new Button();
            checkBoxPostBar = new CheckBox();
            buttonRelayList = new Button();
            labelRelays = new Label();
            toolTipRelays = new ToolTip(components);
            SuspendLayout();
            // 
            // buttonStart
            // 
            buttonStart.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            buttonStart.Image = Properties.Resources.icons8_start_16;
            buttonStart.Location = new Point(211, 12);
            buttonStart.Name = "buttonStart";
            buttonStart.Size = new Size(23, 23);
            buttonStart.TabIndex = 2;
            buttonStart.UseVisualStyleBackColor = true;
            buttonStart.Click += ButtonStart_Click;
            // 
            // textBoxTimeline
            // 
            textBoxTimeline.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            textBoxTimeline.BackColor = SystemColors.Window;
            textBoxTimeline.Location = new Point(12, 41);
            textBoxTimeline.MaxLength = 0;
            textBoxTimeline.Multiline = true;
            textBoxTimeline.Name = "textBoxTimeline";
            textBoxTimeline.ReadOnly = true;
            textBoxTimeline.ScrollBars = ScrollBars.Vertical;
            textBoxTimeline.Size = new Size(280, 198);
            textBoxTimeline.TabIndex = 5;
            textBoxTimeline.TabStop = false;
            textBoxTimeline.MouseEnter += TextBoxTimeline_MouseEnter;
            textBoxTimeline.MouseLeave += TextBoxTimeline_MouseLeave;
            // 
            // buttonStop
            // 
            buttonStop.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            buttonStop.Enabled = false;
            buttonStop.Image = Properties.Resources.icons8_stop_16;
            buttonStop.Location = new Point(240, 12);
            buttonStop.Name = "buttonStop";
            buttonStop.Size = new Size(23, 23);
            buttonStop.TabIndex = 3;
            buttonStop.UseVisualStyleBackColor = true;
            buttonStop.Click += ButtonStop_Click;
            // 
            // textBoxPost
            // 
            textBoxPost.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            textBoxPost.Enabled = false;
            textBoxPost.Location = new Point(33, 246);
            textBoxPost.MaxLength = 1024;
            textBoxPost.Name = "textBoxPost";
            textBoxPost.PlaceholderText = "Hello Nostr!";
            textBoxPost.Size = new Size(230, 23);
            textBoxPost.TabIndex = 7;
            textBoxPost.KeyDown += TextBoxPost_KeyDown;
            // 
            // buttonPost
            // 
            buttonPost.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            buttonPost.Enabled = false;
            buttonPost.Image = Properties.Resources.icons8_create_16;
            buttonPost.Location = new Point(269, 246);
            buttonPost.Name = "buttonPost";
            buttonPost.Size = new Size(23, 23);
            buttonPost.TabIndex = 8;
            buttonPost.UseVisualStyleBackColor = true;
            buttonPost.Click += ButtonPost_Click;
            // 
            // buttonSetting
            // 
            buttonSetting.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            buttonSetting.Image = Properties.Resources.icons8_setting_16;
            buttonSetting.Location = new Point(269, 12);
            buttonSetting.Name = "buttonSetting";
            buttonSetting.Size = new Size(23, 23);
            buttonSetting.TabIndex = 4;
            buttonSetting.UseVisualStyleBackColor = true;
            buttonSetting.Click += ButtonSetting_Click;
            // 
            // checkBoxPostBar
            // 
            checkBoxPostBar.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            checkBoxPostBar.AutoSize = true;
            checkBoxPostBar.Location = new Point(12, 251);
            checkBoxPostBar.Name = "checkBoxPostBar";
            checkBoxPostBar.Size = new Size(15, 14);
            checkBoxPostBar.TabIndex = 6;
            checkBoxPostBar.UseVisualStyleBackColor = true;
            checkBoxPostBar.CheckedChanged += CheckBoxPostBar_CheckedChanged;
            // 
            // buttonRelayList
            // 
            buttonRelayList.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            buttonRelayList.Image = Properties.Resources.icons8_list_16;
            buttonRelayList.Location = new Point(12, 12);
            buttonRelayList.Name = "buttonRelayList";
            buttonRelayList.Size = new Size(23, 23);
            buttonRelayList.TabIndex = 1;
            buttonRelayList.UseVisualStyleBackColor = true;
            buttonRelayList.Click += ButtonRelayList_Click;
            // 
            // labelRelays
            // 
            labelRelays.AutoSize = true;
            labelRelays.ForeColor = SystemColors.GrayText;
            labelRelays.Location = new Point(41, 16);
            labelRelays.Name = "labelRelays";
            labelRelays.Size = new Size(59, 15);
            labelRelays.TabIndex = 0;
            labelRelays.Text = "Relay info";
            // 
            // FormMain
            // 
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(304, 281);
            Controls.Add(labelRelays);
            Controls.Add(buttonRelayList);
            Controls.Add(checkBoxPostBar);
            Controls.Add(buttonSetting);
            Controls.Add(buttonPost);
            Controls.Add(textBoxPost);
            Controls.Add(buttonStop);
            Controls.Add(textBoxTimeline);
            Controls.Add(buttonStart);
            Icon = (Icon)resources.GetObject("$this.Icon");
            KeyPreview = true;
            MinimumSize = new Size(200, 200);
            Name = "FormMain";
            SizeGripStyle = SizeGripStyle.Show;
            StartPosition = FormStartPosition.Manual;
            Text = "nokakoi";
            TopMost = true;
            FormClosing += FormMain_FormClosing;
            Load += FormMain_Load;
            KeyDown += FormMain_KeyDown;
            MouseClick += FormMain_MouseClick;
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion
        private Button buttonStart;
        private TextBox textBoxTimeline;
        private Button buttonStop;
        private Button buttonPost;
        private Button buttonSetting;
        internal TextBox textBoxPost;
        internal CheckBox checkBoxPostBar;
        private Button buttonRelayList;
        private Label labelRelays;
        private ToolTip toolTipRelays;
    }
}
