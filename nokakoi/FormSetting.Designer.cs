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
            checkBoxAddClient = new CheckBox();
            label5 = new Label();
            linkLabelIcons8 = new LinkLabel();
            checkBoxShowOnlyJapanese = new CheckBox();
            labelVersion = new Label();
            labelOpacity = new Label();
            checkBoxShowOnlyFollowees = new CheckBox();
            label4 = new Label();
            textBoxCutNameLength = new TextBox();
            label8 = new Label();
            checkBoxSendDSSTP = new CheckBox();
            ((System.ComponentModel.ISupportInitialize)trackBarOpacity).BeginInit();
            SuspendLayout();
            // 
            // textBoxNokakoiKey
            // 
            textBoxNokakoiKey.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            textBoxNokakoiKey.BorderStyle = BorderStyle.FixedSingle;
            textBoxNokakoiKey.ImeMode = ImeMode.Disable;
            textBoxNokakoiKey.Location = new Point(88, 145);
            textBoxNokakoiKey.MaxLength = 136;
            textBoxNokakoiKey.Name = "textBoxNokakoiKey";
            textBoxNokakoiKey.Size = new Size(184, 23);
            textBoxNokakoiKey.TabIndex = 7;
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
            textBoxPassword.Location = new Point(88, 174);
            textBoxPassword.MaxLength = 256;
            textBoxPassword.Name = "textBoxPassword";
            textBoxPassword.PasswordChar = '*';
            textBoxPassword.PlaceholderText = "password";
            textBoxPassword.Size = new Size(184, 23);
            textBoxPassword.TabIndex = 8;
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
            label3.Location = new Point(12, 147);
            label3.Name = "label3";
            label3.Size = new Size(70, 15);
            label3.TabIndex = 0;
            label3.Text = "nokakoi key";
            // 
            // checkBoxAddClient
            // 
            checkBoxAddClient.AutoSize = true;
            checkBoxAddClient.Checked = true;
            checkBoxAddClient.CheckState = CheckState.Checked;
            checkBoxAddClient.Location = new Point(172, 203);
            checkBoxAddClient.Name = "checkBoxAddClient";
            checkBoxAddClient.Size = new Size(100, 19);
            checkBoxAddClient.TabIndex = 10;
            checkBoxAddClient.Text = "Add client tag";
            checkBoxAddClient.UseVisualStyleBackColor = true;
            // 
            // label5
            // 
            label5.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            label5.AutoSize = true;
            label5.ForeColor = SystemColors.GrayText;
            label5.Location = new Point(99, 237);
            label5.Name = "label5";
            label5.Size = new Size(126, 15);
            label5.TabIndex = 0;
            label5.Text = "Monochrome icons by";
            // 
            // linkLabelIcons8
            // 
            linkLabelIcons8.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            linkLabelIcons8.AutoSize = true;
            linkLabelIcons8.Location = new Point(231, 237);
            linkLabelIcons8.Name = "linkLabelIcons8";
            linkLabelIcons8.Size = new Size(41, 15);
            linkLabelIcons8.TabIndex = 11;
            linkLabelIcons8.TabStop = true;
            linkLabelIcons8.Text = "Icons8";
            linkLabelIcons8.LinkClicked += LinkLabelIcons8_LinkClicked;
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
            // labelVersion
            // 
            labelVersion.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            labelVersion.AutoSize = true;
            labelVersion.Location = new Point(12, 237);
            labelVersion.Name = "labelVersion";
            labelVersion.Size = new Size(37, 15);
            labelVersion.TabIndex = 0;
            labelVersion.Text = "v0.5.1";
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
            label8.Location = new Point(12, 176);
            label8.Name = "label8";
            label8.Size = new Size(57, 15);
            label8.TabIndex = 0;
            label8.Text = "password";
            // 
            // checkBoxSendDSSTP
            // 
            checkBoxSendDSSTP.AutoSize = true;
            checkBoxSendDSSTP.ForeColor = SystemColors.ControlDark;
            checkBoxSendDSSTP.Location = new Point(12, 203);
            checkBoxSendDSSTP.Name = "checkBoxSendDSSTP";
            checkBoxSendDSSTP.Size = new Size(88, 19);
            checkBoxSendDSSTP.TabIndex = 9;
            checkBoxSendDSSTP.Text = "Send DSSTP";
            checkBoxSendDSSTP.UseVisualStyleBackColor = true;
            // 
            // FormSetting
            // 
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(284, 261);
            Controls.Add(checkBoxSendDSSTP);
            Controls.Add(label8);
            Controls.Add(label4);
            Controls.Add(textBoxCutNameLength);
            Controls.Add(checkBoxShowOnlyFollowees);
            Controls.Add(labelOpacity);
            Controls.Add(labelVersion);
            Controls.Add(checkBoxShowOnlyJapanese);
            Controls.Add(linkLabelIcons8);
            Controls.Add(label5);
            Controls.Add(checkBoxAddClient);
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
            MinimumSize = new Size(300, 300);
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
        internal CheckBox checkBoxAddClient;
        private Label label5;
        private LinkLabel linkLabelIcons8;
        internal CheckBox checkBoxShowOnlyJapanese;
        private Label labelVersion;
        private Label labelOpacity;
        internal CheckBox checkBoxShowOnlyFollowees;
        private Label label4;
        internal TextBox textBoxCutNameLength;
        private Label label8;
        internal CheckBox checkBoxSendDSSTP;
    }
}