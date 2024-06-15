namespace NNostr.Client;

public static class EnumeratorExtensions
{
    public static IEnumerable<T> ToEnumerable<T>(this IEnumerator<T> enumerator)
    {
        while(enumerator.MoveNext())
            yield return enumerator.Current;
    }
}