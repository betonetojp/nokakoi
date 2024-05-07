namespace nokakoi
{
    partial class FormPostBar
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
            System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(FormPostBar));
            textBoxPost = new TextBox();
            buttonPost = new Button();
            SuspendLayout();
            // 
            // textBoxPost
            // 
            textBoxPost.AcceptsReturn = true;
            textBoxPost.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            textBoxPost.BorderStyle = BorderStyle.FixedSingle;
            textBoxPost.Enabled = false;
            textBoxPost.Location = new Point(12, 12);
            textBoxPost.MaxLength = 1024;
            textBoxPost.Multiline = true;
            textBoxPost.Name = "textBoxPost";
            textBoxPost.PlaceholderText = "nokakoi";
            textBoxPost.ScrollBars = ScrollBars.Vertical;
            textBoxPost.Size = new Size(251, 80);
            textBoxPost.TabIndex = 6;
            textBoxPost.KeyDown += TextBoxPost_KeyDown;
            // 
            // buttonPost
            // 
            buttonPost.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            buttonPost.Enabled = false;
            buttonPost.Image = Properties.Resources.icons8_create_16;
            buttonPost.Location = new Point(269, 12);
            buttonPost.Name = "buttonPost";
            buttonPost.Size = new Size(23, 23);
            buttonPost.TabIndex = 7;
            buttonPost.UseVisualStyleBackColor = true;
            buttonPost.Click += ButtonPost_Click;
            // 
            // FormPostBar
            // 
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(304, 104);
            ControlBox = false;
            Controls.Add(buttonPost);
            Controls.Add(textBoxPost);
            FormBorderStyle = FormBorderStyle.SizableToolWindow;
            Icon = (Icon)resources.GetObject("$this.Icon");
            KeyPreview = true;
            MaximizeBox = false;
            MaximumSize = new Size(480, 240);
            MinimizeBox = false;
            MinimumSize = new Size(200, 68);
            Name = "FormPostBar";
            ShowIcon = false;
            ShowInTaskbar = false;
            SizeGripStyle = SizeGripStyle.Show;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            FormClosing += FormPostBar_FormClosing;
            Shown += FormPostBar_Shown;
            DoubleClick += FormPostBar_DoubleClick;
            KeyDown += FormPostBar_KeyDown;
            MouseClick += FormPostBar_MouseClick;
            MouseDown += FormPostBar_MouseDown;
            MouseMove += FormPostBar_MouseMove;
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion
        internal Button buttonPost;
        internal TextBox textBoxPost;
    }
}