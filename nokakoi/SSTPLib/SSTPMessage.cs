using System;

namespace SSTPLib {

    /// <summary>
    /// SSTP�̃��\�b�h��\���񋓑�
    /// </summary>
	public enum SSTPMethod{NOTIFY11,SEND14};

    /// <summary>
    /// SSTP��CharSet��\���񋓑�
    /// </summary>
	public enum SSTPCharset{SHIFT_JIS=0,EUC_JP=1,ISO_2022_JP=2,UTF_8=3};

    /// <summary>
    /// SSTP��Option��\���񋓑�
    /// </summary>
	public enum SSTPOption{None=0,NoDescript=1,NoTranslate=2};

    /// <summary>
    /// SSTP�̌��ʂ�\���񋓑�
    /// </summary>
	public enum SSTPResult{
		OK=200,
		NoContent=204,
		Break=210,
		BadRequest=400,
		RequestTimeout=408,
		Conflict=409,
		Refuse=420,
		NotImplemented=501,
		ServiceUnavailable=503,
		NotLocalIP=510,
		InBlackList=511,
		Invisible=512,
		//
		ServerNotFound=901,
		ResultTimeOut=902,
		SendMessageFailed=903,
		IllegalResultData=904,
		UndefinedResultCode=905
	}

    /// <summary>
    /// SSTP��IfGhost�t���X�N���v�g��\���l
    /// </summary>
	public struct SSTPIfGhostScript{
		public SSTPIfGhostScript(string ifg,string scr){
			ifghost=ifg;
			script=scr;
		}
		public string ifghost;
		public string script;
	}

    /// <summary>
    /// SSTP�̂P���b�Z�[�W��\���N���X�B
    /// ���ɕ�����SSTPIfGhostScript�������Ƃ��ł���B
    /// ���ɕ�����Reference�������Ƃ��ł���B
    /// ���� SEND/1.4 �� NOTIFY/1.1 �̂ݑΉ�
    /// </summary>
	public class SSTPMessage
	{
		private SSTPMethod m_method;
		private SSTPCharset m_charset;
		private string m_sender;
		private string m_event;
		private string[] m_references;
		private SSTPIfGhostScript[] m_ifghosts;
		private int m_option;
		private int m_hwnd;
		private string m_otherheader;
		private string m_XBottleIfGhost;

		private  string[] encstrs={"Shift-JIS","EUC-JP","ISO-2022-JP","UTF-8"};
		private  string[] codestrs={"Shift_JIS","EUC-JP","ISO-2022-JP","UTF-8"};

        /// <summary>
        /// �R���X�g���N�^�BSEND/1.4 UTF-8 �ɏ���������܂��B
        /// </summary>
		public SSTPMessage() {
			m_method=SSTPMethod.SEND14;
			m_charset=SSTPCharset.UTF_8;
			m_sender="SSTPLib1.0";
			m_event="";
			m_references=null;
			m_ifghosts=null;
			m_option=(int)SSTPOption.None;
			m_hwnd=0;
			m_otherheader="";
			m_XBottleIfGhost="";
		}

        /// <summary>
        /// SSTP�̃��\�b�h
        /// </summary>
		public SSTPMethod Method{
			get{return m_method;}
			set{m_method=value;}
		}

        /// <summary>
        /// SSTP��CharSet
        /// </summary>
		public SSTPCharset CharSet{
			get{return m_charset;}
			set{m_charset=value;}
		}

        /// <summary>
        /// SSTP��CharSet��\��������
        /// </summary>
		public string CharsetEncodeText{
			get{return encstrs[(int)this.CharSet];}
		}

        /// <summary>
        /// SSTP��Sender
        /// </summary>
		public string Sender{
			get{return m_sender;}
			set{m_sender=value;}
		}

        /// <summary>
        /// SSTP��Event
        /// </summary>
		public string Event{
			get{return m_event;}
			set{m_event=value;}
		}

        /// <summary>
        /// SSTP��Reference�i�z��A�����w��\�j
        /// </summary>
		public string[] References{
			get{return m_references;}
			set{m_references=value;}
		}

        /// <summary>
        /// SSTP��Script�i�z��A�����w��\�AIfGhost���j
        /// </summary>
		public SSTPIfGhostScript[] Scripts{
			get{return m_ifghosts;}
			set{m_ifghosts=value;}
		}

        /// <summary>
        /// SSTP��Option�iNOTIFY�ŗ��p�j
        /// </summary>
		public int NotifyOption{
			get{return m_option;}
			set{m_option=value;}
		}

        /// <summary>
        /// SSTP��Hwnd
        /// </summary>
		public int HWnd{
			get{return m_hwnd;}
			set{m_hwnd=value;}
		}

        /// <summary>
        /// SSTP��X-Bottle-IfGhost
        /// </summary>
		public string XBottleIfGhost{
			get{return m_XBottleIfGhost;}
			set{m_XBottleIfGhost=value;}
		}

        /// <summary>
        /// SSTP�̂��̑��̃w�b�_�i���s��؂�Ńw�b�_���̂���S�Ďw�肷��j
        /// </summary>
		public string OtherHeader{
			get{return m_otherheader;}
			set{m_otherheader=value;}
		}

        /// <summary>
        /// SSTP�̓��e���o�C�i���Ŏ擾
        /// </summary>
        /// <returns>���̃��b�Z�[�W���w�肳�ꂽCharset�ŃG���R�[�h�����ꍇ�̃o�C�i��</returns>
		public byte[] GetRequest(){
			string text=GetString();
			byte[] request;
			text=text+"Charset: "+codestrs[(int)this.CharSet]+"\r\n";
			request=System.Text.Encoding.GetEncoding(this.CharsetEncodeText).GetBytes(text);
			return request;
		}

        /// <summary>
        /// SSTP�̓��e�𕶎���Ŏ擾
        /// </summary>
        /// <returns>���̃��b�Z�[�W��SSTP������ɂ����ꍇ�̕�����</returns>
		public string GetString(){
			System.Text.StringBuilder sb=new System.Text.StringBuilder();
			switch(m_method){
				case SSTPMethod.NOTIFY11:
					sb.Append("NOTIFY SSTP/1.1\r\n");
					sb.Append("Sender: "+this.Sender+"\r\n");
					sb.Append("Event: "+this.Event+"\r\n");
					if(this.References!=null){
						for(int i=0;i<this.References.Length;i++){
							sb.Append("Reference"+i+": "+this.References[i]+"\r\n");
						}
					}
					break;
				case SSTPMethod.SEND14:
					sb.Append("SEND SSTP/1.4\r\n");
					sb.Append("Sender: "+this.Sender+"\r\n");
					break;
				default:
					return null;
			}
			if(this.Scripts!=null){
				for(int i=0;i<this.Scripts.Length;i++){
					SSTPIfGhostScript ifs=this.Scripts[i];
					if(ifs.ifghost!=null && ifs.ifghost.Length!=0){
						sb.Append("IfGhost: "+ifs.ifghost+"\r\n");
					}
					sb.Append("Script: "+ifs.script+"\r\n");
				}
			}
			if(this.NotifyOption!=(int)SSTPOption.None){
				sb.Append("Option: ");
				if((this.NotifyOption & (int)SSTPOption.NoDescript)!=0){
					sb.Append("nodescript,");
				}
				if((this.NotifyOption & (int)SSTPOption.NoTranslate)!=0){
					sb.Append("notranslate");
				}
				sb.Append("\r\n");
			}
			if(this.HWnd!=0){
				sb.Append("HWnd: "+this.HWnd+"\r\n");
			}
			if(this.XBottleIfGhost!=null && this.XBottleIfGhost.Length!=0){
				sb.Append("X-Bottle-IfGhost: "+this.XBottleIfGhost+"\r\n");
			}
			if(this.OtherHeader!=null && this.OtherHeader.Length!=0){
				sb.Append(this.OtherHeader);
			}
			return sb.ToString();
		}
	}
}
