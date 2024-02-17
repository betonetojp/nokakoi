namespace nokakoi
{
    partial class FormEnc
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
            System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(FormEnc));
            labelNsec = new Label();
            textBoxNsec = new TextBox();
            labelPassword = new Label();
            textBoxPassword = new TextBox();
            labelNokakoiKey = new Label();
            textBoxNokakoiKey = new TextBox();
            buttonEnc = new Button();
            SuspendLayout();
            // 
            // labelNsec
            // 
            labelNsec.AutoSize = true;
            labelNsec.Location = new Point(12, 9);
            labelNsec.Name = "labelNsec";
            labelNsec.Size = new Size(55, 15);
            labelNsec.TabIndex = 0;
            labelNsec.Text = "nsec1 . . .";
            // 
            // textBoxNsec
            // 
            textBoxNsec.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            textBoxNsec.Location = new Point(12, 27);
            textBoxNsec.MaxLength = 63;
            textBoxNsec.Name = "textBoxNsec";
            textBoxNsec.PasswordChar = '*';
            textBoxNsec.PlaceholderText = "nsec1 . . .";
            textBoxNsec.Size = new Size(220, 23);
            textBoxNsec.TabIndex = 1;
            // 
            // labelPassword
            // 
            labelPassword.AutoSize = true;
            labelPassword.Location = new Point(12, 53);
            labelPassword.Name = "labelPassword";
            labelPassword.Size = new Size(57, 15);
            labelPassword.TabIndex = 2;
            labelPassword.Text = "password";
            // 
            // textBoxPassword
            // 
            textBoxPassword.Location = new Point(12, 71);
            textBoxPassword.Name = "textBoxPassword";
            textBoxPassword.PasswordChar = '*';
            textBoxPassword.PlaceholderText = "password";
            textBoxPassword.Size = new Size(139, 23);
            textBoxPassword.TabIndex = 3;
            // 
            // labelNokakoiKey
            // 
            labelNokakoiKey.AutoSize = true;
            labelNokakoiKey.Location = new Point(12, 97);
            labelNokakoiKey.Name = "labelNokakoiKey";
            labelNokakoiKey.Size = new Size(70, 15);
            labelNokakoiKey.TabIndex = 5;
            labelNokakoiKey.Text = "nokakoi key";
            // 
            // textBoxNokakoiKey
            // 
            textBoxNokakoiKey.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            textBoxNokakoiKey.Location = new Point(12, 115);
            textBoxNokakoiKey.Multiline = true;
            textBoxNokakoiKey.Name = "textBoxNokakoiKey";
            textBoxNokakoiKey.Size = new Size(220, 94);
            textBoxNokakoiKey.TabIndex = 6;
            // 
            // buttonEnc
            // 
            buttonEnc.Location = new Point(157, 71);
            buttonEnc.Name = "buttonEnc";
            buttonEnc.Size = new Size(75, 23);
            buttonEnc.TabIndex = 4;
            buttonEnc.Text = "Enc";
            buttonEnc.UseVisualStyleBackColor = true;
            buttonEnc.Click += buttonEnc_Click;
            // 
            // FormEnc
            // 
            AutoScaleDimensions = new SizeF(7F, 15F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(244, 221);
            Controls.Add(buttonEnc);
            Controls.Add(textBoxNokakoiKey);
            Controls.Add(labelNokakoiKey);
            Controls.Add(textBoxPassword);
            Controls.Add(labelPassword);
            Controls.Add(textBoxNsec);
            Controls.Add(labelNsec);
            Icon = (Icon)resources.GetObject("$this.Icon");
            MaximizeBox = false;
            MinimizeBox = false;
            MinimumSize = new Size(260, 260);
            Name = "FormEnc";
            StartPosition = FormStartPosition.CenterScreen;
            Text = "nokakoienc";
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion

        private Label labelNsec;
        private TextBox textBoxNsec;
        private Label labelPassword;
        private TextBox textBoxPassword;
        private Label labelNokakoiKey;
        private TextBox textBoxNokakoiKey;
        private Button buttonEnc;
    }
}
