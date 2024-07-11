namespace nokakoi
{
    partial class FormSetting
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// Clean up any resources being used.
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
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(FormSetting));
            textBoxNokakoiKey = new TextBox();
            textBoxCutLength = new TextBox();
            label1 = new Label();
            textBoxPassword = new TextBox();
            trackBarOpacity = new TrackBar();
            checkBoxTopMost = new CheckBox();
            label2 = new Label();
            label3 = new Label();
            checkBoxAddEndTag = new CheckBox();
            textBoxShortcode = new TextBox();
            checkBoxAddClient = new CheckBox();
            label5 = new Label();
            linkLabelIcons8 = new LinkLabel();
            checkBoxShowOnlyTagged = new CheckBox();
            checkBoxShowOnlyJapanese = new CheckBox();
            label6 = new Label();
            textBoxEmojiUrl = new TextBox();
            label7 = new Label();
            labelVersion = new Label();
            labelOpacity = new Label();
            checkBoxShowOnlyFollowees = new CheckBox();
            label4 = new Label();
            textBoxCutNameLength = new TextBox();
            label8 = new Label();
            checkBoxAutoReaction = new CheckBox();
            checkBoxSendDSSTP = new CheckBox();
            ((System.ComponentModel.ISupportInitialize)trackBarOpacity).BeginInit();
            SuspendLayout();
            // 
            // textBoxNokakoiKey
            // 
            textBoxNokakoiKey.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            textBoxNokakoiKey.BorderStyle = BorderStyle.FixedSingle;
            textBoxNokakoiKey.ImeMode = ImeMode.Disable;
            textBoxNokakoiKey.Location = new Point(88, 252);
            textBoxNokakoiKey.MaxLength = 136;
            textBoxNokakoiKey.Name = "textBoxNokakoiKey";
            textBoxNokakoiKey.Size = new Size(184, 23);
            textBoxNokakoiKey.TabIndex = 12;
            // 
            // textBoxCutLength
            // 
            textBoxCutLength.BorderStyle = BorderStyle.FixedSingle;
            textBoxCutLength.ImeMode = ImeMode.Disable;
            textBoxCutLength.Location = new Point(100, 12);
            textBoxCutLength.MaxLength = 4;
            textBoxCutLength.Name = "textBoxCutLength";
            textBoxCutLength.Size = new Size(26, 23);
            textBoxCutLength.TabIndex = 1;
            // 
            // label1
            // 
            label1.AutoSize = true;
            label1.Location = new Point(12, 14);
            label1.Name = "label1";
            label1.Size = new Size(82, 15);
            label1.TabIndex = 0;
            label1.Text = "Cut content at";
            // 
            // textBoxPassword
            // 
            textBoxPassword.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            textBoxPassword.BorderStyle = BorderStyle.FixedSingle;
            textBoxPassword.ImeMode = ImeMode.Disable;
            textBoxPassword.Location = new Point(88, 281);
            textBoxPassword.MaxLength = 256;
            textBoxPassword.Name = "textBoxPassword";
            textBoxPassword.PasswordChar = '*';
            textBoxPassword.PlaceholderText = "password";
            textBoxPassword.Size = new Size(184, 23);
            textBoxPassword.TabIndex = 13;
            // 
            // trackBarOpacity
            // 
            trackBarOpacity.Location = new Point(145, 31);
            trackBarOpacity.Maximum = 100;
            trackBarOpacity.Minimum = 20;
            trackBarOpacity.Name = "trackBarOpacity";
            trackBarOpacity.Size = new Size(127, 45);
            trackBarOpacity.TabIndex = 2;
            trackBarOpacity.TickFrequency = 20;
            trackBarOpacity.Value = 100;
            trackBarOpacity.Scroll += TrackBarOpacity_Scroll;
            // 
            // checkBoxTopMost
            // 
            checkBoxTopMost.AutoSize = true;
            checkBoxTopMost.Location = new Point(12, 70);
            checkBoxTopMost.Name = "checkBoxTopMost";
            checkBoxTopMost.Size = new Size(101, 19);
            checkBoxTopMost.TabIndex = 4;
            checkBoxTopMost.Text = "Always on top";
            checkBoxTopMost.UseVisualStyleBackColor = true;
            // 
            // label2
            // 
            label2.AutoSize = true;
            label2.Location = new Point(145, 13);
            label2.Name = "label2";
            label2.Size = new Size(48, 15);
            label2.TabIndex = 0;
            label2.Text = "Opacity";
            // 
            // label3
            // 
            label3.AutoSize = true;
            label3.Location = new Point(12, 254);
            label3.Name = "label3";
            label3.Size = new Size(70, 15);
            label3.TabIndex = 0;
            label3.Text = "nokakoi key";
            // 
            // checkBoxAddEndTag
            // 
            checkBoxAddEndTag.AutoSize = true;
            checkBoxAddEndTag.Location = new Point(12, 195);
            checkBoxAddEndTag.Name = "checkBoxAddEndTag";
            checkBoxAddEndTag.Size = new Size(136, 19);
            checkBoxAddEndTag.TabIndex = 9;
            checkBoxAddEndTag.Text = "Add emoji shortcode";
            checkBoxAddEndTag.UseVisualStyleBackColor = true;
            // 
            // textBoxShortcode
            // 
            textBoxShortcode.BorderStyle = BorderStyle.FixedSingle;
            textBoxShortcode.ImeMode = ImeMode.Disable;
            textBoxShortcode.Location = new Point(154, 194);
            textBoxShortcode.Name = "textBoxShortcode";
            textBoxShortcode.Size = new Size(52, 23);
            textBoxShortcode.TabIndex = 10;
            textBoxShortcode.Text = "n";
            // 
            // checkBoxAddClient
            // 
            checkBoxAddClient.AutoSize = true;
            checkBoxAddClient.Location = new Point(12, 170);
            checkBoxAddClient.Name = "checkBoxAddClient";
            checkBoxAddClient.Size = new Size(173, 19);
            checkBoxAddClient.TabIndex = 8;
            checkBoxAddClient.Text = "Add tag [\"client\",\"nokakoi\"]";
            checkBoxAddClient.UseVisualStyleBackColor = true;
            // 
            // label5
            // 
            label5.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            label5.AutoSize = true;
            label5.ForeColor = SystemColors.GrayText;
            label5.Location = new Point(99, 337);
            label5.Name = "label5";
            label5.Size = new Size(126, 15);
            label5.TabIndex = 0;
            label5.Text = "Monochrome icons by";
            // 
            // linkLabelIcons8
            // 
            linkLabelIcons8.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            linkLabelIcons8.AutoSize = true;
            linkLabelIcons8.Location = new Point(231, 337);
            linkLabelIcons8.Name = "linkLabelIcons8";
            linkLabelIcons8.Size = new Size(41, 15);
            linkLabelIcons8.TabIndex = 16;
            linkLabelIcons8.TabStop = true;
            linkLabelIcons8.Text = "Icons8";
            linkLabelIcons8.LinkClicked += LinkLabelIcons8_LinkClicked;
            // 
            // checkBoxShowOnlyTagged
            // 
            checkBoxShowOnlyTagged.AutoSize = true;
            checkBoxShowOnlyTagged.Location = new Point(12, 145);
            checkBoxShowOnlyTagged.Name = "checkBoxShowOnlyTagged";
            checkBoxShowOnlyTagged.Size = new Size(185, 19);
            checkBoxShowOnlyTagged.TabIndex = 7;
            checkBoxShowOnlyTagged.Text = "Show only posts from nokakoi";
            checkBoxShowOnlyTagged.UseVisualStyleBackColor = true;
            // 
            // checkBoxShowOnlyJapanese
            // 
            checkBoxShowOnlyJapanese.AutoSize = true;
            checkBoxShowOnlyJapanese.Location = new Point(12, 120);
            checkBoxShowOnlyJapanese.Name = "checkBoxShowOnlyJapanese";
            checkBoxShowOnlyJapanese.Size = new Size(162, 19);
            checkBoxShowOnlyJapanese.TabIndex = 6;
            checkBoxShowOnlyJapanese.Text = "Show only Japanese posts";
            checkBoxShowOnlyJapanese.UseVisualStyleBackColor = true;
            // 
            // label6
            // 
            label6.AutoSize = true;
            label6.Location = new Point(103, 219);
            label6.Name = "label6";
            label6.Size = new Size(0, 15);
            label6.TabIndex = 14;
            // 
            // textBoxEmojiUrl
            // 
            textBoxEmojiUrl.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            textBoxEmojiUrl.BorderStyle = BorderStyle.FixedSingle;
            textBoxEmojiUrl.ImeMode = ImeMode.Disable;
            textBoxEmojiUrl.Location = new Point(88, 223);
            textBoxEmojiUrl.Name = "textBoxEmojiUrl";
            textBoxEmojiUrl.Size = new Size(184, 23);
            textBoxEmojiUrl.TabIndex = 11;
            textBoxEmojiUrl.Text = "https://betoneto.win/media/nokakoi.png";
            // 
            // label7
            // 
            label7.AutoSize = true;
            label7.Location = new Point(12, 225);
            label7.Name = "label7";
            label7.Size = new Size(60, 15);
            label7.TabIndex = 0;
            label7.Text = "emoji URL";
            // 
            // labelVersion
            // 
            labelVersion.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            labelVersion.AutoSize = true;
            labelVersion.Location = new Point(12, 337);
            labelVersion.Name = "labelVersion";
            labelVersion.Size = new Size(37, 15);
            labelVersion.TabIndex = 0;
            labelVersion.Text = "v0.4.9";
            // 
            // labelOpacity
            // 
            labelOpacity.Location = new Point(231, 13);
            labelOpacity.Name = "labelOpacity";
            labelOpacity.Size = new Size(41, 15);
            labelOpacity.TabIndex = 0;
            labelOpacity.Text = "100%";
            labelOpacity.TextAlign = ContentAlignment.TopRight;
            // 
            // checkBoxShowOnlyFollowees
            // 
            checkBoxShowOnlyFollowees.AutoSize = true;
            checkBoxShowOnlyFollowees.Location = new Point(12, 95);
            checkBoxShowOnlyFollowees.Name = "checkBoxShowOnlyFollowees";
            checkBoxShowOnlyFollowees.Size = new Size(134, 19);
            checkBoxShowOnlyFollowees.TabIndex = 5;
            checkBoxShowOnlyFollowees.Text = "Show only followees";
            checkBoxShowOnlyFollowees.UseVisualStyleBackColor = true;
            // 
            // label4
            // 
            label4.AutoSize = true;
            label4.Location = new Point(12, 43);
            label4.Name = "label4";
            label4.Size = new Size(70, 15);
            label4.TabIndex = 0;
            label4.Text = "Cut name at";
            // 
            // textBoxCutNameLength
            // 
            textBoxCutNameLength.BorderStyle = BorderStyle.FixedSingle;
            textBoxCutNameLength.ImeMode = ImeMode.Disable;
            textBoxCutNameLength.Location = new Point(100, 41);
            textBoxCutNameLength.MaxLength = 4;
            textBoxCutNameLength.Name = "textBoxCutNameLength";
            textBoxCutNameLength.Size = new Size(26, 23);
            textBoxCutNameLength.TabIndex = 3;
            // 
            // label8
            // 
            label8.AutoSize = true;
            label8.Location = new Point(12, 283);
            label8.Name = "label8";
            label8.Size = new Size(57, 15);
            label8.TabIndex = 0;
            label8.Text = "password";
            // 
            // checkBoxAutoReaction
            // 
            checkBoxAutoReaction.AutoSize = true;
            checkBoxAutoReaction.ForeColor = SystemColors.ControlDark;
            checkBoxAutoReaction.Location = new Point(174, 310);
            checkBoxAutoReaction.Name = "checkBoxAutoReaction";
            checkBoxAutoReaction.Size = new Size(98, 19);
            checkBoxAutoReaction.TabIndex = 15;
            checkBoxAutoReaction.Text = "Auto reaction";
            checkBoxAutoReaction.UseVisualStyleBackColor = true;
            // 
            // checkBoxSendDSSTP
            // 
            checkBoxSendDSSTP.AutoSize = true;
            checkBoxSendDSSTP.Checked = true;
            checkBoxSendDSSTP.CheckState = CheckState.Checked;
            checkBoxSendDSSTP.ForeColor = SystemColors.ControlDark;
            checkBoxSendDSSTP.Location = new Point(12, 310);
            checkBoxSendDSSTP.Name = "checkBoxSendDSSTP";
            checkBoxSendDSSTP.Size = new Size(88, 19);
            checkBoxSendDSSTP.TabIndex = 14;
            checkBoxSendDSSTP.Text = "Send DSSTP";
            checkBoxSendDSSTP.UseVisualStyleBackColor = true;
            // 
            // FormSetting
            // 
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(284, 361);
            Controls.Add(checkBoxSendDSSTP);
            Controls.Add(checkBoxAutoReaction);
            Controls.Add(label8);
            Controls.Add(label4);
            Controls.Add(textBoxCutNameLength);
            Controls.Add(checkBoxShowOnlyFollowees);
            Controls.Add(labelOpacity);
            Controls.Add(labelVersion);
            Controls.Add(label7);
            Controls.Add(textBoxEmojiUrl);
            Controls.Add(label6);
            Controls.Add(checkBoxShowOnlyJapanese);
            Controls.Add(checkBoxShowOnlyTagged);
            Controls.Add(linkLabelIcons8);
            Controls.Add(label5);
            Controls.Add(checkBoxAddClient);
            Controls.Add(textBoxShortcode);
            Controls.Add(checkBoxAddEndTag);
            Controls.Add(label3);
            Controls.Add(label2);
            Controls.Add(checkBoxTopMost);
            Controls.Add(trackBarOpacity);
            Controls.Add(textBoxPassword);
            Controls.Add(label1);
            Controls.Add(textBoxCutLength);
            Controls.Add(textBoxNokakoiKey);
            Icon = (Icon)resources.GetObject("$this.Icon");
            KeyPreview = true;
            MaximizeBox = false;
            MinimizeBox = false;
            MinimumSize = new Size(300, 400);
            Name = "FormSetting";
            ShowInTaskbar = false;
            SizeGripStyle = SizeGripStyle.Show;
            StartPosition = FormStartPosition.CenterParent;
            Text = "Setting";
            TopMost = true;
            Load += FormSetting_Load;
            Shown += FormSetting_Shown;
            KeyDown += FormSetting_KeyDown;
            ((System.ComponentModel.ISupportInitialize)trackBarOpacity).EndInit();
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion

        internal TextBox textBoxNokakoiKey;
        private Label label1;
        internal TextBox textBoxCutLength;
        internal TextBox textBoxPassword;
        internal TrackBar trackBarOpacity;
        internal CheckBox checkBoxTopMost;
        private Label label2;
        private Label label3;
        internal CheckBox checkBoxAddEndTag;
        internal TextBox textBoxShortcode;
        internal CheckBox checkBoxAddClient;
        private Label label5;
        private LinkLabel linkLabelIcons8;
        internal CheckBox checkBoxShowOnlyTagged;
        internal CheckBox checkBoxShowOnlyJapanese;
        private Label label6;
        private Label label7;
        internal TextBox textBoxEmojiUrl;
        private Label labelVersion;
        private Label labelOpacity;
        internal CheckBox checkBoxShowOnlyFollowees;
        private Label label4;
        internal TextBox textBoxCutNameLength;
        private Label label8;
        internal CheckBox checkBoxAutoReaction;
        internal CheckBox checkBoxSendDSSTP;
    }
}