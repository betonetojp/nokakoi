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
            buttonConnect = new Button();
            buttonStart = new Button();
            textBoxTimeline = new TextBox();
            buttonStop = new Button();
            textBoxPost = new TextBox();
            buttonPost = new Button();
            buttonSetting = new Button();
            SuspendLayout();
            // 
            // textBoxRelay
            // 
            textBoxRelay.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            textBoxRelay.ImeMode = ImeMode.Disable;
            textBoxRelay.Location = new Point(12, 12);
            textBoxRelay.Name = "textBoxRelay";
            textBoxRelay.PlaceholderText = "wss://";
            textBoxRelay.Size = new Size(193, 23);
            textBoxRelay.TabIndex = 0;
            // 
            // buttonConnect
            // 
            buttonConnect.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            buttonConnect.Image = Properties.Resources.icons8_connect_16;
            buttonConnect.Location = new Point(211, 12);
            buttonConnect.Name = "buttonConnect";
            buttonConnect.Size = new Size(23, 23);
            buttonConnect.TabIndex = 1;
            buttonConnect.UseVisualStyleBackColor = true;
            buttonConnect.Click += buttonConnect_Click;
            // 
            // buttonStart
            // 
            buttonStart.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            buttonStart.Enabled = false;
            buttonStart.Image = Properties.Resources.icons8_start_16;
            buttonStart.Location = new Point(240, 12);
            buttonStart.Name = "buttonStart";
            buttonStart.Size = new Size(23, 23);
            buttonStart.TabIndex = 2;
            buttonStart.UseVisualStyleBackColor = true;
            buttonStart.Click += buttonStart_Click;
            // 
            // textBoxTimeline
            // 
            textBoxTimeline.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            textBoxTimeline.Location = new Point(12, 41);
            textBoxTimeline.Multiline = true;
            textBoxTimeline.Name = "textBoxTimeline";
            textBoxTimeline.ScrollBars = ScrollBars.Vertical;
            textBoxTimeline.Size = new Size(280, 198);
            textBoxTimeline.TabIndex = 4;
            textBoxTimeline.MouseEnter += textBoxTimeline_MouseEnter;
            textBoxTimeline.MouseLeave += textBoxTimeline_MouseLeave;
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
            buttonStop.Click += buttonStop_Click;
            // 
            // textBoxPost
            // 
            textBoxPost.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            textBoxPost.Location = new Point(12, 246);
            textBoxPost.Name = "textBoxPost";
            textBoxPost.PlaceholderText = "Hello Nostr!";
            textBoxPost.Size = new Size(222, 23);
            textBoxPost.TabIndex = 5;
            // 
            // buttonPost
            // 
            buttonPost.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            buttonPost.Enabled = false;
            buttonPost.Image = Properties.Resources.icons8_create_16;
            buttonPost.Location = new Point(240, 246);
            buttonPost.Name = "buttonPost";
            buttonPost.Size = new Size(23, 23);
            buttonPost.TabIndex = 6;
            buttonPost.UseVisualStyleBackColor = true;
            buttonPost.Click += buttonPost_Click;
            // 
            // buttonSetting
            // 
            buttonSetting.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            buttonSetting.Image = Properties.Resources.icons8_setting_16;
            buttonSetting.Location = new Point(269, 246);
            buttonSetting.Name = "buttonSetting";
            buttonSetting.Size = new Size(23, 23);
            buttonSetting.TabIndex = 7;
            buttonSetting.UseVisualStyleBackColor = true;
            buttonSetting.Click += buttonSetting_Click;
            // 
            // FormMain
            // 
            AutoScaleDimensions = new SizeF(7F, 15F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(304, 281);
            Controls.Add(buttonSetting);
            Controls.Add(buttonPost);
            Controls.Add(textBoxPost);
            Controls.Add(buttonStop);
            Controls.Add(textBoxTimeline);
            Controls.Add(buttonStart);
            Controls.Add(buttonConnect);
            Controls.Add(textBoxRelay);
            Icon = (Icon)resources.GetObject("$this.Icon");
            MinimumSize = new Size(200, 200);
            Name = "FormMain";
            StartPosition = FormStartPosition.Manual;
            Text = "nokakoi";
            TopMost = true;
            FormClosing += FormMain_FormClosing;
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion

        private TextBox textBoxRelay;
        private Button buttonConnect;
        private Button buttonStart;
        private TextBox textBoxTimeline;
        private Button buttonStop;
        private TextBox textBoxPost;
        private Button buttonPost;
        private Button buttonSetting;
    }
}
