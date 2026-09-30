import { DocumentationResources } from "../../strings/documentation";

class MethodMetadata {
    public constructor(
        public readonly typeName: string,
        public readonly methodName: string,
        public readonly returnsValue: boolean,
        public readonly parameters: ReadonlyArray<string>) {
    }

    public get description(): string {
        return DocumentationResources.get(`${this.typeName}_${this.methodName}`);
    }

    // Hints and signatures show parameter names spelled like the official
    // documentation (camelCase), while the resources are keyed with the
    // PascalCase spelling stored in `parameters`.
    public get displayParameterNames(): ReadonlyArray<string> {
        return this.parameters.map(parameter => parameter.length > 0
            ? parameter.charAt(0).toLowerCase() + parameter.substring(1)
            : parameter);
    }

    public parameterDescription(name: string): string {
        const description = DocumentationResources.get(`${this.typeName}_${this.methodName}_${name}`);
        return typeof description === "string" ? description : name;
    }
}

class PropertyMetadata {
    public constructor(
        public readonly typeName: string,
        public readonly propertyName: string,
        public readonly hasGetter: boolean,
        public readonly hasSetter: boolean) {
    }

    public get description(): string {
        return DocumentationResources.get(`${this.typeName}_${this.propertyName}`);
    }
}

class EventMetadata {
    public constructor(
        public readonly typeName: string,
        public readonly eventName: string) {
    }

    public get description(): string {
        return DocumentationResources.get(`${this.typeName}_${this.eventName}`);
    }
}

class TypeMetadata {
    public constructor(
        public readonly typeName: string,
        public readonly methods: { readonly [name: string]: MethodMetadata },
        public readonly properties: { readonly [name: string]: PropertyMetadata },
        public readonly events: { readonly [name: string]: EventMetadata }) {
    }

    public get description(): string {
        return DocumentationResources.get(this.typeName);
    }
}

export class LibrariesMetadata {
    readonly [name: string]: TypeMetadata;

    public readonly Array: TypeMetadata = new TypeMetadata("Array",
        {
            IsArray: new MethodMetadata("Array", "IsArray", true, ["Array"]),
            GetItemCount: new MethodMetadata("Array", "GetItemCount", true, ["Array"]),
            GetAllIndices: new MethodMetadata("Array", "GetAllIndices", true, ["Array"]),
            ContainsValue: new MethodMetadata("Array", "ContainsValue", true, ["Array", "Value"]),
            ContainsIndex: new MethodMetadata("Array", "ContainsIndex", true, ["Array", "Index"]),
            GetValue: new MethodMetadata("Array", "GetValue", true, ["ArrayName", "Index"]),
            RemoveValue: new MethodMetadata("Array", "RemoveValue", false, ["ArrayName", "Index"]),
            SetValue: new MethodMetadata("Array", "SetValue", false, ["ArrayName", "Index", "Value"])
        },
        {
            // No Properties
        },
        {
            // No Events
        });

    public readonly Clock: TypeMetadata = new TypeMetadata("Clock",
        {
            // No Methods
        },
        {
            Time: new PropertyMetadata("Clock", "Time", true, false)
        },
        {
            // No Events
        });

    public readonly Controls: TypeMetadata = new TypeMetadata("Controls",
        {
            AddButton: new MethodMetadata("Controls", "AddButton", true, ["Caption", "Left", "Top"]),
            GetButtonCaption: new MethodMetadata("Controls", "GetButtonCaption", true, ["ButtonName"]),
            SetButtonCaption: new MethodMetadata("Controls", "SetButtonCaption", false, ["ButtonName", "Caption"]),
            AddTextBox: new MethodMetadata("Controls", "AddTextBox", true, ["Left", "Top"]),
            AddMultiLineTextBox: new MethodMetadata("Controls", "AddMultiLineTextBox", true, ["Left", "Top"]),
            GetTextBoxText: new MethodMetadata("Controls", "GetTextBoxText", true, ["TextBoxName"]),
            SetTextBoxText: new MethodMetadata("Controls", "SetTextBoxText", true, ["TextBoxName", "Text"]),
            Remove: new MethodMetadata("Controls", "Remove", false, ["ControlName"]),
            Move: new MethodMetadata("Controls", "Move", false, ["Control", "X", "Y"]),
            SetSize: new MethodMetadata("Controls", "SetSize", false, ["Control", "Width", "Height"]),
            HideControl: new MethodMetadata("Controls", "HideControl", false, ["ControlName"]),
            ShowControl: new MethodMetadata("Controls", "ShowControl", false, ["ControlName"])
        },
        {
            LastClickedButton: new PropertyMetadata("Controls", "LastClickedButton", true, false),
            LastTypedTextBox: new PropertyMetadata("Controls", "LastTypedTextBox", true, false)
        },
        {
            ButtonClicked: new EventMetadata("Controls", "ButtonClicked"),
            TextTyped: new EventMetadata("Controls", "TextTyped")
        });

    public readonly Desktop: TypeMetadata = new TypeMetadata("Desktop",
        {
            SetWallPaper: new MethodMetadata("Desktop", "SetWallPaper", false, ["FileOrUrl"])
        },
        {
            Height: new PropertyMetadata("Desktop", "Height", true, false),
            Width: new PropertyMetadata("Desktop", "Width", true, false)
        },
        {
            // No Events
        });

    public readonly Dictionary: TypeMetadata = new TypeMetadata("Dictionary",
        {
            GetDefinition: new MethodMetadata("Dictionary", "GetDefinition", true, ["Word"])
        },
        {
            // No Properties
        },
        {
            // No Events
        });

    public readonly File: TypeMetadata = new TypeMetadata("File",
        {
            AppendContents: new MethodMetadata("File", "AppendContents", false, ["FilePath", "Contents"]),
            CopyFile: new MethodMetadata("File", "CopyFile", false, ["SourceFilePath", "DestinationFilePath"]),
            DeleteDirectory: new MethodMetadata("File", "DeleteDirectory", false, ["DirectoryPath"]),
            DeleteFile: new MethodMetadata("File", "DeleteFile", false, ["FilePath"]),
            GetDirectories: new MethodMetadata("File", "GetDirectories", true, ["DirectoryPath"]),
            GetFiles: new MethodMetadata("File", "GetFiles", true, ["DirectoryPath"]),
            GetSettingsFilePath: new MethodMetadata("File", "GetSettingsFilePath", true, []),
            GetTemporaryFilePath: new MethodMetadata("File", "GetTemporaryFilePath", true, []),
            InsertLine: new MethodMetadata("File", "InsertLine", false, ["FilePath", "LineNumber", "Contents"]),
            ReadContents: new MethodMetadata("File", "ReadContents", true, ["FilePath"]),
            ReadLine: new MethodMetadata("File", "ReadLine", true, ["FilePath", "LineNumber"])
        },
        {
            // No Properties
        },
        {
            // No Events
        });

    public readonly Flickr: TypeMetadata = new TypeMetadata("Flickr",
        {
            GetPictureOfMoment: new MethodMetadata("Flickr", "GetPictureOfMoment", true, []),
            GetPictureOfMomentWithTag: new MethodMetadata("Flickr", "GetPictureOfMomentWithTag", true, ["Tag"]),
            GetRandomPicture: new MethodMetadata("Flickr", "GetRandomPicture", true, ["Tag"]),
            GetRandomPictureWithTag: new MethodMetadata("Flickr", "GetRandomPictureWithTag", true, ["Tag"])
        },
        {
            // No Properties
        },
        {
            // No Events
        });

    public readonly GraphicsWindow: TypeMetadata = new TypeMetadata("GraphicsWindow",
        {
            Clear: new MethodMetadata("GraphicsWindow", "Clear", false, []),
            DrawBoundText: new MethodMetadata("GraphicsWindow", "DrawBoundText", false, ["X", "Y", "Width", "Text"]),
            DrawEllipse: new MethodMetadata("GraphicsWindow", "DrawEllipse", false, ["X", "Y", "Width", "Height"]),
            DrawImage: new MethodMetadata("GraphicsWindow", "DrawImage", false, ["ImageName", "X", "Y"]),
            DrawLine: new MethodMetadata("GraphicsWindow", "DrawLine", false, ["X1", "Y1", "X2", "Y2"]),
            DrawRectangle: new MethodMetadata("GraphicsWindow", "DrawRectangle", false, ["X", "Y", "Width", "Height"]),
            DrawResizedImage: new MethodMetadata("GraphicsWindow", "DrawResizedImage", false, ["ImageName", "X", "Y", "Width", "Height"]),
            DrawText: new MethodMetadata("GraphicsWindow", "DrawText", false, ["X", "Y", "Text"]),
            DrawTriangle: new MethodMetadata("GraphicsWindow", "DrawTriangle", false, ["X1", "Y1", "X2", "Y2", "X3", "Y3"]),
            FillEllipse: new MethodMetadata("GraphicsWindow", "FillEllipse", false, ["X", "Y", "Width", "Height"]),
            FillRectangle: new MethodMetadata("GraphicsWindow", "FillRectangle", false, ["X", "Y", "Width", "Height"]),
            FillTriangle: new MethodMetadata("GraphicsWindow", "FillTriangle", false, ["X1", "Y1", "X2", "Y2", "X3", "Y3"]),
            GetColorFromRGB: new MethodMetadata("GraphicsWindow", "GetColorFromRGB", true, ["Red", "Green", "Blue"]),
            GetPixel: new MethodMetadata("GraphicsWindow", "GetPixel", true, ["X", "Y"]),
            GetRandomColor: new MethodMetadata("GraphicsWindow", "GetRandomColor", true, []),
            Hide: new MethodMetadata("GraphicsWindow", "Hide", false, []),
            SetPixel: new MethodMetadata("GraphicsWindow", "SetPixel", false, ["X", "Y", "Color"]),
            Show: new MethodMetadata("GraphicsWindow", "Show", false, []),
            ShowMessage: new MethodMetadata("GraphicsWindow", "ShowMessage", false, ["Text", "Title"])
        },
        {
            BackgroundColor: new PropertyMetadata("GraphicsWindow", "BackgroundColor", true, true),
            BrushColor: new PropertyMetadata("GraphicsWindow", "BrushColor", true, true),
            CanResize: new PropertyMetadata("GraphicsWindow", "CanResize", true, true),
            FontBold: new PropertyMetadata("GraphicsWindow", "FontBold", true, true),
            FontItalic: new PropertyMetadata("GraphicsWindow", "FontItalic", true, true),
            FontName: new PropertyMetadata("GraphicsWindow", "FontName", true, true),
            FontSize: new PropertyMetadata("GraphicsWindow", "FontSize", true, true),
            Height: new PropertyMetadata("GraphicsWindow", "Height", true, true),
            LastKey: new PropertyMetadata("GraphicsWindow", "LastKey", true, false),
            LastText: new PropertyMetadata("GraphicsWindow", "LastText", true, false),
            Left: new PropertyMetadata("GraphicsWindow", "Left", true, true),
            MouseX: new PropertyMetadata("GraphicsWindow", "MouseX", true, false),
            MouseY: new PropertyMetadata("GraphicsWindow", "MouseY", true, false),
            PenColor: new PropertyMetadata("GraphicsWindow", "PenColor", true, true),
            PenWidth: new PropertyMetadata("GraphicsWindow", "PenWidth", true, true),
            Title: new PropertyMetadata("GraphicsWindow", "Title", true, true),
            Top: new PropertyMetadata("GraphicsWindow", "Top", true, true),
            Width: new PropertyMetadata("GraphicsWindow", "Width", true, true)
        },
        {
            KeyDown: new EventMetadata("GraphicsWindow", "KeyDown"),
            KeyUp: new EventMetadata("GraphicsWindow", "KeyUp"),
            MouseDown: new EventMetadata("GraphicsWindow", "MouseDown"),
            MouseMove: new EventMetadata("GraphicsWindow", "MouseMove"),
            MouseUp: new EventMetadata("GraphicsWindow", "MouseUp"),
            TextInput: new EventMetadata("GraphicsWindow", "TextInput")
        });

    public readonly ImageList: TypeMetadata = new TypeMetadata("ImageList",
        {
            GetHeightOfImage: new MethodMetadata("ImageList", "GetHeightOfImage", true, ["ImageName"]),
            GetWidthOfImage: new MethodMetadata("ImageList", "GetWidthOfImage", true, ["ImageName"]),
            LoadImage: new MethodMetadata("ImageList", "LoadImage", true, ["FileNameOrUrl"])
        },
        {
            // No Properties
        },
        {
            // No Events
        });

    public readonly Mouse: TypeMetadata = new TypeMetadata("Mouse",
        {
            HideCursor: new MethodMetadata("Mouse", "HideCursor", false, []),
            ShowCursor: new MethodMetadata("Mouse", "ShowCursor", false, [])
        },
        {
            IsLeftButtonDown: new PropertyMetadata("Mouse", "IsLeftButtonDown", true, false),
            IsRightButtonDown: new PropertyMetadata("Mouse", "IsRightButtonDown", true, false)
        },
        {
            // No Events
        });

    public readonly Network: TypeMetadata = new TypeMetadata("Network",
        {
            DownloadFile: new MethodMetadata("Network", "DownloadFile", true, ["URL"]),
            GetWebPageContents: new MethodMetadata("Network", "GetWebPageContents", true, ["URL"])
        },
        {
            // No Properties
        },
        {
            // No Events
        });

    public readonly Sound: TypeMetadata = new TypeMetadata("Sound",
        {
            Pause: new MethodMetadata("Sound", "Pause", false, ["FilePath"]),
            Play: new MethodMetadata("Sound", "Play", false, ["FilePath"]),
            PlayBellRing: new MethodMetadata("Sound", "PlayBellRing", false, []),
            PlayChime: new MethodMetadata("Sound", "PlayChime", false, []),
            PlayMusic: new MethodMetadata("Sound", "PlayMusic", false, ["Notes"]),
            Resume: new MethodMetadata("Sound", "Resume", false, []),
            Stop: new MethodMetadata("Sound", "Stop", false, ["FilePath"])
        },
        {
            // No Properties
        },
        {
            // No Events
        });

    public readonly Text: TypeMetadata = new TypeMetadata("Text",
        {
            Append: new MethodMetadata("Text", "Append", true, ["Text1", "Text2"]),
            ConvertToLowerCase: new MethodMetadata("Text", "ConvertToLowerCase", true, ["Text"]),
            ConvertToUpperCase: new MethodMetadata("Text", "ConvertToUpperCase", true, ["Text"]),
            EndsWith: new MethodMetadata("Text", "EndsWith", true, ["Text", "SubText"]),
            GetCharacter: new MethodMetadata("Text", "GetCharacter", true, ["CharacterCode"]),
            GetCharacterCode: new MethodMetadata("Text", "GetCharacterCode", true, ["Character"]),
            GetIndexOf: new MethodMetadata("Text", "GetIndexOf", true, ["Text", "SubText"]),
            GetLength: new MethodMetadata("Text", "GetLength", true, ["Text"]),
            GetSubText: new MethodMetadata("Text", "GetSubText", true, ["Text", "Start", "Length"]),
            GetSubTextToEnd: new MethodMetadata("Text", "GetSubTextToEnd", true, ["Text", "Start"]),
            GetWord: new MethodMetadata("Text", "GetWord", true, ["Text", "Index"]),
            GetWordCount: new MethodMetadata("Text", "GetWordCount", true, ["Text"]),
            IsSubText: new MethodMetadata("Text", "IsSubText", true, ["Text", "SubText"]),
            StartsWith: new MethodMetadata("Text", "StartsWith", true, ["Text", "SubText"])
        },
        {
            // No Properties
        },
        {
            // No Events
        });

    public readonly Timer: TypeMetadata = new TypeMetadata("Timer",
        {
            Pause: new MethodMetadata("Timer", "Pause", false, []),
            Resume: new MethodMetadata("Timer", "Resume", false, [])
        },
        {
            Interval: new PropertyMetadata("Timer", "Interval", true, true)
        },
        {
            Tick: new EventMetadata("Timer", "Tick")
        });

    public readonly Math: TypeMetadata = new TypeMetadata("Math",
        {
            Abs: new MethodMetadata("Math", "Abs", true, ["Number"]),
            Remainder: new MethodMetadata("Math", "Remainder", true, ["Dividend", "Divisor"]),

            Cos: new MethodMetadata("Math", "Cos", true, ["Angle"]),
            Sin: new MethodMetadata("Math", "Sin", true, ["Angle"]),
            Tan: new MethodMetadata("Math", "Tan", true, ["Angle"]),

            ArcCos: new MethodMetadata("Math", "ArcCos", true, ["CosValue"]),
            ArcSin: new MethodMetadata("Math", "ArcSin", true, ["SinValue"]),
            ArcTan: new MethodMetadata("Math", "ArcTan", true, ["TanValue"]),

            Ceiling: new MethodMetadata("Math", "Ceiling", true, ["Number"]),
            Floor: new MethodMetadata("Math", "Floor", true, ["Number"]),
            Round: new MethodMetadata("Math", "Round", true, ["Number"]),

            GetDegrees: new MethodMetadata("Math", "GetDegrees", true, ["Angle"]),
            GetRadians: new MethodMetadata("Math", "GetRadians", true, ["Angle"]),

            GetRandomNumber: new MethodMetadata("Math", "GetRandomNumber", true, ["MaxNumber"]),

            Log: new MethodMetadata("Math", "Log", true, ["Number"]),
            NaturalLog: new MethodMetadata("Math", "NaturalLog", true, ["Number"]),

            Max: new MethodMetadata("Math", "Max", true, ["Number1", "Number2"]),
            Min: new MethodMetadata("Math", "Min", true, ["Number1", "Number2"]),

            Power: new MethodMetadata("Math", "Power", true, ["BaseNumber", "Exponent"]),
            SquareRoot: new MethodMetadata("Math", "SquareRoot", true, ["Number"])
        },
        {
            Pi: new PropertyMetadata("Math", "Pi", true, false)
        },
        {
            // No Events
        });

    public readonly Program: TypeMetadata = new TypeMetadata("Program",
        {
            Delay: new MethodMetadata("Program", "Delay", false, ["milliSeconds"]),
            Pause: new MethodMetadata("Program", "Pause", false, []),
            End: new MethodMetadata("Program", "End", false, [])
        },
        {
            // No Properties
        },
        {
            // No Events
        });

    public readonly Shapes: TypeMetadata = new TypeMetadata("Shapes",
        {
            AddRectangle: new MethodMetadata("Shapes", "AddRectangle", true, ["Width", "Height"]),
            AddEllipse: new MethodMetadata("Shapes", "AddEllipse", true, ["Width", "Height"]),
            AddTriangle: new MethodMetadata("Shapes", "AddTriangle", true, ["X1", "Y1", "X2", "Y2", "X3", "Y3"]),
            AddLine: new MethodMetadata("Shapes", "AddLine", true, ["X1", "Y1", "X2", "Y2"]),
            AddImage: new MethodMetadata("Shapes", "AddImage", true, ["ImageName"]),
            AddText: new MethodMetadata("Shapes", "AddText", true, ["Text"]),
            SetText: new MethodMetadata("Shapes", "SetText", false, ["ShapeName", "Text"]),
            Remove: new MethodMetadata("Shapes", "Remove", false, ["ShapeName"]),
            Move: new MethodMetadata("Shapes", "Move", false, ["ShapeName", "X", "Y"]),
            Rotate: new MethodMetadata("Shapes", "Rotate", false, ["ShapeName", "Angle"]),
            Zoom: new MethodMetadata("Shapes", "Zoom", false, ["ShapeName", "ScaleX", "ScaleY"]),
            Animate: new MethodMetadata("Shapes", "Animate", false, ["ShapeName", "X", "Y", "Duration"]),
            GetLeft: new MethodMetadata("Shapes", "GetLeft", true, ["ShapeName"]),
            GetTop: new MethodMetadata("Shapes", "GetTop", true, ["ShapeName"]),
            GetOpacity: new MethodMetadata("Shapes", "GetOpacity", true, ["ShapeName"]),
            SetOpacity: new MethodMetadata("Shapes", "SetOpacity", false, ["ShapeName", "Level"]),
            HideShape: new MethodMetadata("Shapes", "HideShape", false, ["ShapeName"]),
            ShowShape: new MethodMetadata("Shapes", "ShowShape", false, ["ShapeName"])
        },
        {
            // No Properties
        },
        {
            // No Events
        });

    public readonly Stack: TypeMetadata = new TypeMetadata("Stack",
        {
            PushValue: new MethodMetadata("Stack", "PushValue", false, ["StackName", "Value"]),
            GetCount: new MethodMetadata("Stack", "GetCount", true, ["StackName"]),
            PopValue: new MethodMetadata("Stack", "PopValue", true, ["StackName"])
        },
        {
            // No Properties
        },
        {
            // No Events
        });

    public readonly TextWindow: TypeMetadata = new TypeMetadata("TextWindow",
        {
            Read: new MethodMetadata("TextWindow", "Read", true, []),
            ReadNumber: new MethodMetadata("TextWindow", "ReadNumber", true, []),

            Write: new MethodMetadata("TextWindow", "Write", false, ["Data"]),
            WriteLine: new MethodMetadata("TextWindow", "WriteLine", false, ["Data"])
        },
        {
            ForegroundColor: new PropertyMetadata("TextWindow", "ForegroundColor", true, true),
            BackgroundColor: new PropertyMetadata("TextWindow", "BackgroundColor", true, true)
        },
        {
            // No Events
        });

    public readonly Turtle: TypeMetadata = new TypeMetadata("Turtle",
        {
            Show: new MethodMetadata("Turtle", "Show", false, []),
            Hide: new MethodMetadata("Turtle", "Hide", false, []),

            PenDown: new MethodMetadata("Turtle", "PenDown", false, []),
            PenUp: new MethodMetadata("Turtle", "PenUp", false, []),

            Move: new MethodMetadata("Turtle", "Move", false, ["Distance"]),
            MoveTo: new MethodMetadata("Turtle", "MoveTo", false, ["X", "Y"]),

            Turn: new MethodMetadata("Turtle", "Turn", false, ["Angle"]),
            TurnLeft: new MethodMetadata("Turtle", "TurnLeft", false, []),
            TurnRight: new MethodMetadata("Turtle", "TurnRight", false, [])
        },
        {
            Speed: new PropertyMetadata("Turtle", "Speed", true, true),
            Angle: new PropertyMetadata("Turtle", "Angle", true, true),

            X: new PropertyMetadata("Turtle", "X", true, true),
            Y: new PropertyMetadata("Turtle", "Y", true, true)
        },
        {
            // No Events
        });
}
