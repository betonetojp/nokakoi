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
            System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(FormMain));
            textBoxRelay = new TextBox();
            buttonStart = new Button();
            textBoxTimeline = new TextBox();
            buttonStop = new Button();
            textBoxPost = new TextBox();
            buttonPost = new Button();
            buttonSetting = new Button();
            checkBoxPostBar = new CheckBox();
            SuspendLayout();
            // 
            // textBoxRelay
            // 
            textBoxRelay.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            textBoxRelay.ImeMode = ImeMode.Disable;
            textBoxRelay.Location = new Point(12, 12);
            textBoxRelay.MaxLength = 256;
            textBoxRelay.Name = "textBoxRelay";
            textBoxRelay.PlaceholderText = "wss://";
            textBoxRelay.Size = new Size(222, 23);
            textBoxRelay.TabIndex = 0;
            // 
            // buttonStart
            // 
            buttonStart.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            buttonStart.Image = Properties.Resources.icons8_start_16;
            buttonStart.Location = new Point(240, 12);
            buttonStart.Name = "buttonStart";
            buttonStart.Size = new Size(23, 23);
            buttonStart.TabIndex = 2;
            buttonStart.UseVisualStyleBackColor = true;
            buttonStart.Click += ButtonStart_Click;
            // 
            // textBoxTimeline
            // 
            textBoxTimeline.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            textBoxTimeline.Location = new Point(12, 41);
            textBoxTimeline.MaxLength = 0;
            textBoxTimeline.Multiline = true;
            textBoxTimeline.Name = "textBoxTimeline";
            textBoxTimeline.ScrollBars = ScrollBars.Vertical;
            textBoxTimeline.Size = new Size(280, 198);
            textBoxTimeline.TabIndex = 4;
            textBoxTimeline.MouseEnter += TextBoxTimeline_MouseEnter;
            textBoxTimeline.MouseLeave += TextBoxTimeline_MouseLeave;
            // 
            // buttonStop
            // 
            buttonStop.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            buttonStop.Enabled = false;
            buttonStop.Image = Properties.Resources.icons8_stop_16;
            buttonStop.Location = new Point(269, 12);
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
            textBoxPost.Location = new Point(33, 247);
            textBoxPost.MaxLength = 1024;
            textBoxPost.Name = "textBoxPost";
            textBoxPost.PlaceholderText = "Hello Nostr!";
            textBoxPost.Size = new Size(201, 23);
            textBoxPost.TabIndex = 6;
            textBoxPost.KeyDown += TextBoxPost_KeyDown;
            // 
            // buttonPost
            // 
            buttonPost.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            buttonPost.Enabled = false;
            buttonPost.Image = Properties.Resources.icons8_create_16;
            buttonPost.Location = new Point(240, 246);
            buttonPost.Name = "buttonPost";
            buttonPost.Size = new Size(23, 23);
            buttonPost.TabIndex = 7;
            buttonPost.UseVisualStyleBackColor = true;
            buttonPost.Click += ButtonPost_Click;
            // 
            // buttonSetting
            // 
            buttonSetting.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            buttonSetting.Image = Properties.Resources.icons8_setting_16;
            buttonSetting.Location = new Point(269, 246);
            buttonSetting.Name = "buttonSetting";
            buttonSetting.Size = new Size(23, 23);
            buttonSetting.TabIndex = 8;
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
            checkBoxPostBar.TabIndex = 5;
            checkBoxPostBar.UseVisualStyleBackColor = true;
            checkBoxPostBar.CheckedChanged += CheckBoxPostBar_CheckedChanged;
            // 
            // FormMain
            // 
            AutoScaleDimensions = new SizeF(7F, 15F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(304, 281);
            Controls.Add(checkBoxPostBar);
            Controls.Add(buttonSetting);
            Controls.Add(buttonPost);
            Controls.Add(textBoxPost);
            Controls.Add(buttonStop);
            Controls.Add(textBoxTimeline);
            Controls.Add(buttonStart);
            Controls.Add(textBoxRelay);
            Icon = (Icon)resources.GetObject("$this.Icon");
            MinimumSize = new Size(200, 200);
            Name = "FormMain";
            StartPosition = FormStartPosition.Manual;
            Text = "nokakoi";
            TopMost = true;
            FormClosing += FormMain_FormClosing;
            Load += FormMain_Load;
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion

        private TextBox textBoxRelay;
        private Button buttonStart;
        private TextBox textBoxTimeline;
        private Button buttonStop;
        private Button buttonPost;
        private Button buttonSetting;
        internal TextBox textBoxPost;
        internal CheckBox checkBoxPostBar;
    }
}
