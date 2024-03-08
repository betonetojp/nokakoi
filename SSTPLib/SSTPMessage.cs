using System;

namespace SSTPLib {

    /// <summary>
    /// SSTPのメソッドを表す列挙体
    /// </summary>
	public enum SSTPMethod{NOTIFY11,SEND14};

    /// <summary>
    /// SSTPのCharSetを表す列挙体
    /// </summary>
	public enum SSTPCharset{SHIFT_JIS=0,EUC_JP=1,ISO_2022_JP=2,UTF_8=3};

    /// <summary>
    /// SSTPのOptionを表す列挙体
    /// </summary>
	public enum SSTPOption{None=0,NoDescript=1,NoTranslate=2};

    /// <summary>
    /// SSTPの結果を表す列挙体
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
    /// SSTPのIfGhost付きスクリプトを表す値
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
    /// SSTPの１メッセージを表すクラス。
    /// 中に複数のSSTPIfGhostScriptを持つことができる。
    /// 中に複数のReferenceを持つことができる。
    /// 現在 SEND/1.4 と NOTIFY/1.1 のみ対応
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
        /// コンストラクタ。SEND/1.4 UTF-8 に初期化されます。
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
        /// SSTPのメソッド
        /// </summary>
		public SSTPMethod Method{
			get{return m_method;}
			set{m_method=value;}
		}

        /// <summary>
        /// SSTPのCharSet
        /// </summary>
		public SSTPCharset CharSet{
			get{return m_charset;}
			set{m_charset=value;}
		}

        /// <summary>
        /// SSTPのCharSetを表す文字列
        /// </summary>
		public string CharsetEncodeText{
			get{return encstrs[(int)this.CharSet];}
		}

        /// <summary>
        /// SSTPのSender
        /// </summary>
		public string Sender{
			get{return m_sender;}
			set{m_sender=value;}
		}

        /// <summary>
        /// SSTPのEvent
        /// </summary>
		public string Event{
			get{return m_event;}
			set{m_event=value;}
		}

        /// <summary>
        /// SSTPのReference（配列、複数指定可能）
        /// </summary>
		public string[] References{
			get{return m_references;}
			set{m_references=value;}
		}

        /// <summary>
        /// SSTPのScript（配列、複数指定可能、IfGhostつき）
        /// </summary>
		public SSTPIfGhostScript[] Scripts{
			get{return m_ifghosts;}
			set{m_ifghosts=value;}
		}

        /// <summary>
        /// SSTPのOption（NOTIFYで利用）
        /// </summary>
		public int NotifyOption{
			get{return m_option;}
			set{m_option=value;}
		}

        /// <summary>
        /// SSTPのHwnd
        /// </summary>
		public int HWnd{
			get{return m_hwnd;}
			set{m_hwnd=value;}
		}

        /// <summary>
        /// SSTPのX-Bottle-IfGhost
        /// </summary>
		public string XBottleIfGhost{
			get{return m_XBottleIfGhost;}
			set{m_XBottleIfGhost=value;}
		}

        /// <summary>
        /// SSTPのその他のヘッダ（改行区切りでヘッダ名称から全て指定する）
        /// </summary>
		public string OtherHeader{
			get{return m_otherheader;}
			set{m_otherheader=value;}
		}

        /// <summary>
        /// SSTPの内容をバイナリで取得
        /// </summary>
        /// <returns>このメッセージを指定されたCharsetでエンコードした場合のバイナリ</returns>
		public byte[] GetRequest(){
			string text=GetString();
			byte[] request;
			text=text+"Charset: "+codestrs[(int)this.CharSet]+"\r\n";
			request=System.Text.Encoding.GetEncoding(this.CharsetEncodeText).GetBytes(text);
			return request;
		}

        /// <summary>
        /// SSTPの内容を文字列で取得
        /// </summary>
        /// <returns>このメッセージをSSTP文字列にした場合の文字列</returns>
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
